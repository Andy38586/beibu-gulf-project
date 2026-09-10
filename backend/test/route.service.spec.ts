import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import { RouteRepository } from '../src/modules/route/repositories/route.repository'
import { RouteService } from '../src/modules/route/services/route.service'

// route 域业务层单测（下沉 pgRouting 后新增，2026-09-10）
//
// 覆盖：参数校验（经纬度越界 / mode 白名单）/ 空结果的三种 reason
//（origin_not_snapped / destination_not_snapped / unreachable，形状逐字段对齐 FastAPI）/
// 两口径同源汇总 / 几何去重拼接。
//
// 注：取档与寻路语义在 SQL 内（pgr_withPoints + cost_m/cost_min），属集成测试范畴
//（本地起 postgis 后 export V3_INTEGRATION_DB=1 联调）；此处 mock repository
// 验证 service 的编排与契约。SQL 文本级护栏见同目录 route.repository.spec.ts。

function makeRepoMock() {
  return {
    snapPoints: vi.fn(),
    shortestPathByPoints: vi.fn(),
    sumEdgeCosts: vi.fn(),
    pathGeometry: vi.fn(),
    countTraversableEdges: vi.fn(),
  } as unknown as RouteRepository & {
    snapPoints: ReturnType<typeof vi.fn>
    shortestPathByPoints: ReturnType<typeof vi.fn>
    sumEdgeCosts: ReturnType<typeof vi.fn>
    pathGeometry: ReturnType<typeof vi.fn>
  }
}

const SNAP_FROM = { pid: -1, edge_id: '1001', fraction: 0.25, snap_m: 654.84 }
const SNAP_TO = { pid: -2, edge_id: '2002', fraction: 0.75, snap_m: 629.13 }

/**
 * 构造一次最小「成功」响应。
 * 用于只关心参数/口径透传的用例——空结果分支已不带 mode（见 RoutePathEmpty），
 * 故不能再用「吸附失败」来验证 mode 回落。
 */
function mockSuccessPath(repo: ReturnType<typeof makeRepoMock>) {
  repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
  repo.shortestPathByPoints.mockResolvedValue([
    { seq: 1, path_seq: 1, node: '1001', edge: '1001', cost: 100, agg_cost: 0 },
  ])
  repo.sumEdgeCosts.mockResolvedValue({ distanceM: 100, durationMin: 1 })
  repo.pathGeometry.mockResolvedValue([{ seq: 1, coords: [[108.6, 21.7]] }])
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

  it('有吸附点但无路径（拓扑不连通）→ 空因为 unreachable，与"无可通行边"可区分', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    // 对齐 graph.py:419 的 NetworkXNoPath 分支
    expect(r).toEqual({ found: false, reason: 'unreachable' })
  })

  it('成功路径 → 两口径同源汇总 + edgeCount + 去重坐标链', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([
      { seq: 1, path_seq: 1, node: '1001', edge: '1001', cost: 100, agg_cost: 0 },
      { seq: 2, path_seq: 2, node: '55', edge: '3003', cost: 16000, agg_cost: 100 },
      { seq: 3, path_seq: 3, node: '2002', edge: '2002', cost: 268, agg_cost: 16100 },
    ])
    repo.sumEdgeCosts.mockResolvedValue({ distanceM: 16368.4, durationMin: 26.7 })
    repo.pathGeometry.mockResolvedValue([
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

    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.7, toLng: 108.7, toLat: 21.75 })
    // 精确断言成功形状（字段集对齐 graph.py:431-437）
    expect(r).toEqual({
      found: true,
      mode: 'distance',
      distanceM: 16368.4,
      durationMin: 26.7,
      snapDistanceM: { from: 654.8, to: 629.1 },
      edgeCount: 3,
      // 相邻段重合点去重后 3 个点（而非 4 个）
      coordinates: [
        [108.6, 21.7],
        [108.601979, 21.706018],
        [108.603089, 21.708101],
      ],
    })
    // 两口径必须来自同一次汇总（同源不混算）
    expect(repo.sumEdgeCosts).toHaveBeenCalledTimes(1)
    expect(repo.sumEdgeCosts).toHaveBeenCalledWith([1001, 3003, 2002])
  })

  it('time 模式应把 mode 透传到寻路层（权重列选择在 repository 内）', async () => {
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

  it('寻路返回的虚拟点边（edge <= 0）应被过滤，不计入 edgeCount', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([
      { seq: 1, path_seq: 1, node: '1001', edge: '-1', cost: 0, agg_cost: 0 },
      { seq: 2, path_seq: 2, node: '55', edge: '3003', cost: 16000, agg_cost: 0 },
    ])
    repo.sumEdgeCosts.mockResolvedValue({ distanceM: 16000, durationMin: 20 })
    repo.pathGeometry.mockResolvedValue([{ seq: 1, coords: [[108.6, 21.7]] }])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.7, toLng: 108.7, toLat: 21.75 })
    expect(r).toMatchObject({ found: true, edgeCount: 1 })
    expect(repo.sumEdgeCosts).toHaveBeenCalledWith([3003])
  })

  it('几何全空（城市外）→ 走合法空结果 unreachable，不夹带坐标字段', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([
      { seq: 1, path_seq: 1, node: '55', edge: '3003', cost: 100, agg_cost: 0 },
    ])
    repo.sumEdgeCosts.mockResolvedValue({ distanceM: 100, durationMin: 0.1 })
    repo.pathGeometry.mockResolvedValue([])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.7, toLng: 108.7, toLat: 21.75 })
    expect(r).toEqual({ found: false, reason: 'unreachable' })
  })
})
