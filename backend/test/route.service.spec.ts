import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import {
  PID_FROM,
  PID_TO,
  RouteRepository,
  type WithPointsRow,
} from '../src/modules/route/repositories/route.repository'
import { buildSegments, RouteService } from '../src/modules/route/services/route.service'

// route 域业务层单测（下沉 pgRouting 后新增，2026-09-10）
//
// 覆盖：参数校验（经纬度越界 / mode 白名单）/ 空结果的三种 reason
//（origin_not_snapped / destination_not_snapped / unreachable，形状逐字段对齐 FastAPI）/
// 行→分段的翻译（buildSegments，纯函数：方向判定与截取区间是本次修复的核心）/
// 两口径同源汇总 / 几何去重拼接。
//
// 注：寻路语义在 SQL 内（pgr_withPoints + cost_m/cost_min），属集成测试范畴
//（本地起 postgis 后 export V3_INTEGRATION_DB=1 联调）；此处 mock repository
// 验证 service 的编排与契约。SQL 文本级护栏见同目录 route.repository.spec.ts。

function makeRepoMock() {
  return {
    snapPoints: vi.fn(),
    shortestPathByPoints: vi.fn(),
    sumSegmentCosts: vi.fn(),
    segmentGeometry: vi.fn(),
    countTraversableEdges: vi.fn(),
  } as unknown as RouteRepository & {
    snapPoints: ReturnType<typeof vi.fn>
    shortestPathByPoints: ReturnType<typeof vi.fn>
    sumSegmentCosts: ReturnType<typeof vi.fn>
    segmentGeometry: ReturnType<typeof vi.fn>
  }
}

/** 吸附结果：pid 必须是 repository 导出的正数常量 */
const SNAP_FROM = { pid: PID_FROM, edge_id: '237591', fraction: 0.25, snap_m: 654.84 }
const SNAP_TO = { pid: PID_TO, edge_id: '174719', fraction: 0.75, snap_m: 629.13 }

/**
 * 两行真实结构（照抄 2026-09-10 服务器实测的 `pgr_withPoints` 返回）：
 *   node = 从哪个节点出发（负数为吸附点）；edge = 走的那条边，最后一行为终点哨兵 -1；
 *   cost = 该段**实际**费用（部分边已按 fraction 折算）。
 */
const ROW_EDGE1: WithPointsRow = {
  seq: 1,
  path_seq: 1,
  node: '-1',
  edge: '1001',
  cost: 50,
  agg_cost: 0,
  edge_source: 1,
  edge_target: 2,
}
const ROW_EDGE2: WithPointsRow = {
  seq: 2,
  path_seq: 2,
  node: '2',
  edge: '2002',
  cost: 50,
  agg_cost: 50,
  edge_source: 2,
  edge_target: 3,
}
const ROW_TERMINAL: WithPointsRow = {
  seq: 3,
  path_seq: 3,
  node: '-2',
  edge: '-1',
  cost: 0,
  agg_cost: 100,
  edge_source: null,
  edge_target: null,
}

/** 构造一次最小「成功」响应（空结果分支不再带 mode，故不能用吸附失败来验证 mode 回落） */
function mockSuccessPath(repo: ReturnType<typeof makeRepoMock>) {
  repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
  repo.shortestPathByPoints.mockResolvedValue([ROW_EDGE1, ROW_EDGE2, ROW_TERMINAL])
  repo.sumSegmentCosts.mockResolvedValue({ distanceM: 100, durationMin: 1 })
  repo.segmentGeometry.mockResolvedValue([
    {
      seq: 1,
      coords: [
        [108.6, 21.7],
        [108.601979, 21.706018],
      ],
    },
    // 第二段首点与上段末点重合 → 应被去重
    {
      seq: 2,
      coords: [
        [108.601979, 21.706018],
        [108.603089, 21.708101],
      ],
    },
  ])
}

describe('RouteService.findPath - 参数校验', () => {
  let repo: ReturnType<typeof makeRepoMock>
  let service: RouteService

  beforeEach(() => {
    repo = makeRepoMock()
    service = new RouteService(repo)
  })

  it('mode 非 distance/time 应触发业务错误（白名单，防注入）', async () => {
    await expect(
      service.findPath({
        fromLng: 108.6,
        fromLat: 21.6,
        toLng: 108.7,
        toLat: 21.7,
        mode: 'fastest',
      })
    ).rejects.toBeInstanceOf(BusinessError)
    expect(repo.snapPoints).not.toHaveBeenCalled()
  })

  it('mode 缺省应回落 distance', async () => {
    mockSuccessPath(repo)
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    expect(r).toMatchObject({ found: true, mode: 'distance' })
  })

  it('mode 为空串应回落 distance（兼容前端未传参）', async () => {
    mockSuccessPath(repo)
    const r = await service.findPath({
      fromLng: 108.6,
      fromLat: 21.6,
      toLng: 108.7,
      toLat: 21.7,
      mode: '',
    })
    expect(r).toMatchObject({ found: true, mode: 'distance' })
  })

  it.each([
    ['fromLng 越界', { fromLng: 200, fromLat: 21.6, toLng: 108.7, toLat: 21.7 }],
    ['toLat 越界', { fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: -91 }],
    ['fromLat NaN', { fromLng: 108.6, fromLat: NaN, toLng: 108.7, toLat: 21.7 }],
    ['toLng Infinity', { fromLng: 108.6, fromLat: 21.6, toLng: Infinity, toLat: 21.7 }],
  ])('%s 应触发业务错误', async (_name, params) => {
    await expect(service.findPath(params)).rejects.toBeInstanceOf(BusinessError)
  })
})

describe('RouteService.findPath - 空结果与契约', () => {
  let repo: ReturnType<typeof makeRepoMock>
  let service: RouteService

  beforeEach(() => {
    repo = makeRepoMock()
    service = new RouteService(repo)
  })

  it('吸附失败（附近无可通行边）→ 合法空结果 origin_not_snapped，不硬吸远路', async () => {
    repo.snapPoints.mockResolvedValue([]) // 起终点都吸附不上
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    // 精确形状：对齐 graph.py:406 与前端 schemas.ts found:false 分支（只认这两个字段）
    expect(r).toEqual({ found: false, reason: 'origin_not_snapped' })
    // 未吸附即短路，不应发起寻路
    expect(repo.shortestPathByPoints).not.toHaveBeenCalled()
  })

  it('仅起点吸附成功 → 空因为 destination_not_snapped（判定顺序同 graph.py:404-409）', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    expect(r).toEqual({ found: false, reason: 'destination_not_snapped' })
  })

  it('仅终点吸附成功 → 空因为 origin_not_snapped（缺一不可）', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_TO])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    expect(r).toEqual({ found: false, reason: 'origin_not_snapped' })
  })

  it('有吸附点但无路径（pgr_withPoints 返 0 行）→ 空因为 unreachable', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    // 对齐 graph.py:419 的 NetworkXNoPath 分支
    expect(r).toEqual({ found: false, reason: 'unreachable' })
  })

  it('只有终点哨兵行（edge <= 0）→ 分段为空 → unreachable（不能靠 rows.length 判空）', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([ROW_TERMINAL])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    expect(r).toEqual({ found: false, reason: 'unreachable' })
  })

  it('几何全空（拼不出坐标）→ unreachable，不夹带坐标字段', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([ROW_EDGE1, ROW_EDGE2, ROW_TERMINAL])
    repo.sumSegmentCosts.mockResolvedValue({ distanceM: 100, durationMin: 1 })
    repo.segmentGeometry.mockResolvedValue([])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.7, toLng: 108.7, toLat: 21.75 })
    expect(r).toEqual({ found: false, reason: 'unreachable' })
  })
})

describe('buildSegments - 行 → 分段（本次修复的核心逻辑）', () => {
  it('首段：吸附点出发、下一跳是该边的 target → 正向，截取 [fromFraction, 1]', () => {
    const segs = buildSegments([ROW_EDGE1, ROW_EDGE2, ROW_TERMINAL], 0.5, 0.5)
    expect(segs[0]).toEqual({ edgeId: 1001, lo: 0.5, hi: 1, reverse: false, cost: 50 })
  })

  it('首段：下一跳是该边的 source → 反向，截取 [0, fromFraction]（坐标需反转）', () => {
    // 把 ROW_EDGE1 的下一跳顶点改成边 1001 的 source(=1) → 说明从吸附点朝 source 走
    const back: WithPointsRow = { ...ROW_EDGE2, node: '1' }
    const segs = buildSegments([ROW_EDGE1, back, ROW_TERMINAL], 0.25, 0.5)
    expect(segs[0]).toEqual({ edgeId: 1001, lo: 0, hi: 0.25, reverse: true, cost: 50 })
  })

  it('末段：出发顶点 = 该边 source → 截取 [0, toFraction]', () => {
    const segs = buildSegments([ROW_EDGE1, ROW_EDGE2, ROW_TERMINAL], 0.5, 0.75)
    expect(segs[1]).toEqual({ edgeId: 2002, lo: 0, hi: 0.75, reverse: false, cost: 50 })
  })

  it('末段：出发顶点 = 该边 target → 截取 [toFraction, 1] 且需反转', () => {
    // 边 2002 的 source=2/target=3；让出发顶点为 3（target）→ 朝吸附点反向走
    const fromTarget: WithPointsRow = { ...ROW_EDGE2, node: '3' }
    const segs = buildSegments([ROW_EDGE1, fromTarget, ROW_TERMINAL], 0.5, 0.3)
    expect(segs[1]).toEqual({ edgeId: 2002, lo: 0.3, hi: 1, reverse: true, cost: 50 })
  })

  it('起终点落在同一条边上（首段即末段）→ 区间取两 fraction 之间，方向按大小定', () => {
    const sameEdge: WithPointsRow = { ...ROW_EDGE1, edge: '1001', cost: 48.3 }
    // fromFraction(0.25) < toFraction(0.75) → 正向
    let segs = buildSegments([sameEdge, ROW_TERMINAL], 0.25, 0.75)
    expect(segs).toEqual([{ edgeId: 1001, lo: 0.25, hi: 0.75, reverse: false, cost: 48.3 }])

    // 反过来：fromFraction(0.75) > toFraction(0.25) → 反向
    segs = buildSegments([sameEdge, ROW_TERMINAL], 0.75, 0.25)
    expect(segs).toEqual([{ edgeId: 1001, lo: 0.25, hi: 0.75, reverse: true, cost: 48.3 }])
  })

  it('终点哨兵行（edge <= 0）不得进入分段', () => {
    const segs = buildSegments([ROW_EDGE1, ROW_EDGE2, ROW_TERMINAL], 0.5, 0.5)
    expect(segs).toHaveLength(2)
    expect(segs.every((s) => s.edgeId > 0)).toBe(true)
  })

  it('pg 把 bigint 列按字符串返回：edge_source 为字符串时方向判定不得误判（2026-09-13 产线事故回归）', () => {
    // 曾经 `departure === cur.edge_source` 用 number 与 string 严格比较 → 恒 false
    // → 除首段外每段都被误判成逆向、整段坐标被反转，路径线画成"被打乱的线"。
    // 上面既有用例的夹具把 edge_source 写成 number，恰好掩盖了该坑——本用例按 pg
    // 真实返回形态（bigint → string）构造，锁死行为。
    const pgStyleRow1: WithPointsRow = {
      seq: 1,
      path_seq: 1,
      node: '-1',
      edge: '1001',
      cost: 50,
      agg_cost: 0,
      edge_source: '1' as unknown as number,
      edge_target: '2' as unknown as number,
    }
    const pgStyleRow2: WithPointsRow = {
      seq: 2,
      path_seq: 2,
      node: '2',
      edge: '2002',
      cost: 50,
      agg_cost: 50,
      edge_source: '2' as unknown as number,
      edge_target: '3' as unknown as number,
    }
    const segs = buildSegments([pgStyleRow1, pgStyleRow2, ROW_TERMINAL], 0.5, 0.5)
    // 首段：arrival(2) === Number(target)(2) → 正向
    expect(segs[0]).toEqual({ edgeId: 1001, lo: 0.5, hi: 1, reverse: false, cost: 50 })
    // 中段：departure(2) === Number(source)(2) → 正向（修复前此处恒 reverse:true）
    expect(segs[1]).toEqual({ edgeId: 2002, lo: 0, hi: 1, reverse: false, cost: 50 })
  })
})

describe('RouteService.findPath - 成功路径', () => {
  let repo: ReturnType<typeof makeRepoMock>
  let service: RouteService

  beforeEach(() => {
    repo = makeRepoMock()
    service = new RouteService(repo)
  })

  it('成功路径 → 两口径同源汇总 + edgeCount + 去重坐标链', async () => {
    mockSuccessPath(repo)

    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.7, toLng: 108.7, toLat: 21.75 })
    // 精确断言成功形状（字段集对齐 graph.py:431-437）
    expect(r).toEqual({
      found: true,
      mode: 'distance',
      distanceM: 100,
      durationMin: 1,
      snapDistanceM: { from: 654.8, to: 629.1 },
      edgeCount: 2,
      // 相邻段重合点去重后 3 个点（而非 4 个）
      coordinates: [
        [108.6, 21.7],
        [108.601979, 21.706018],
        [108.603089, 21.708101],
      ],
    })
    // 两口径必须来自同一次汇总（同源不混算），且带的是**分段**而不是边 id 列表
    expect(repo.sumSegmentCosts).toHaveBeenCalledTimes(1)
    expect(repo.sumSegmentCosts).toHaveBeenCalledWith(
      [
        { edgeId: 1001, lo: 0.25, hi: 1, reverse: false, cost: 50 },
        { edgeId: 2002, lo: 0, hi: 0.75, reverse: false, cost: 50 },
      ],
      'distance'
    )
  })

  it('time 模式应把 mode 透传到寻路层与汇总层（权重列选择在 repository 内）', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([])
    await service.findPath({
      fromLng: 108.6,
      fromLat: 21.6,
      toLng: 108.7,
      toLat: 21.7,
      mode: 'time',
    })
    expect(repo.shortestPathByPoints).toHaveBeenCalledWith([SNAP_FROM, SNAP_TO], 'time')
  })

  it('零长度分段（吸附点恰在边的端点上、且朝该端点方向走）不进几何查询，但不影响 edgeCount', async () => {
    // W4 实测的真实形态：起点投影在边 1001 的 source 上（fraction=0），且朝 source 走
    // → 首段 lo=0/hi=0 是退化区间，ST_LineSubstring(geom, 0, 0) 没必要交给 DB
    const back: WithPointsRow = { ...ROW_EDGE2, node: '1' } // 首段反向
    repo.snapPoints.mockResolvedValue([{ ...SNAP_FROM, fraction: 0 }, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([ROW_EDGE1, back, ROW_TERMINAL])
    repo.sumSegmentCosts.mockResolvedValue({ distanceM: 100, durationMin: 1 })
    repo.segmentGeometry.mockResolvedValue([
      {
        seq: 1,
        coords: [
          [108.6, 21.6],
          [108.7, 21.7],
        ],
      },
    ])

    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.7, toLng: 108.7, toLat: 21.75 })
    expect(repo.segmentGeometry).toHaveBeenCalledWith([
      { edgeId: 2002, lo: 0.75, hi: 1, reverse: true, cost: 50 },
    ])
    // edgeCount 仍按真实路径边数（退化段也是路径的一部分），不被几何裁剪影响
    expect(r).toMatchObject({ found: true, edgeCount: 2 })
  })

  it('反向分段应把坐标倒过来，使折线首尾相接（真实路网里两条边的数字方向可以不一致）', async () => {
    // 边 1001：source 1 / target 2；边 2002：source 3 / target 2 —— 两条边都接到顶点 2
    // → 第 1 段从吸附点走到 target(2)：正向；第 2 段从顶点 2 出发但 2 是它的 target：反向
    const rowA: WithPointsRow = {
      seq: 1,
      path_seq: 1,
      node: '-1',
      edge: '1001',
      cost: 50,
      agg_cost: 0,
      edge_source: 1,
      edge_target: 2,
    }
    const rowB: WithPointsRow = {
      seq: 2,
      path_seq: 2,
      node: '2',
      edge: '2002',
      cost: 50,
      agg_cost: 50,
      edge_source: 3,
      edge_target: 2,
    }
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([rowA, rowB, ROW_TERMINAL])
    repo.sumSegmentCosts.mockResolvedValue({ distanceM: 100, durationMin: 1 })
    repo.segmentGeometry.mockResolvedValue([
      // 几何顺序（fraction 递增）：顶点1 → 顶点2
      {
        seq: 1,
        coords: [
          [108.5, 21.5],
          [108.6, 21.6],
        ],
      },
      // 几何顺序：吸附终点(0.75) → 顶点2；需反转后才是行进顺序
      {
        seq: 2,
        coords: [
          [108.7, 21.7],
          [108.6, 21.6],
        ],
      },
    ])

    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.7, toLng: 108.7, toLat: 21.75 })
    expect(repo.sumSegmentCosts).toHaveBeenCalledWith(
      [
        { edgeId: 1001, lo: 0.25, hi: 1, reverse: false, cost: 50 },
        { edgeId: 2002, lo: 0.75, hi: 1, reverse: true, cost: 50 },
      ],
      'distance'
    )
    expect(r).toMatchObject({
      found: true,
      // 第 2 段反转后以其顶点2 端接上第 1 段末点 → 去重成一条顺畅折线
      coordinates: [
        [108.5, 21.5],
        [108.6, 21.6],
        [108.7, 21.7],
      ],
    })
  })
})
