import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import { RouteRepository } from '../src/modules/route/repositories/route.repository'
import { RouteService } from '../src/modules/route/services/route.service'

// route 域业务层单测（下沉 pgRouting 后新增，2026-09-10）
//
// 覆盖：参数校验（经纬度越界 / mode 白名单）/ 吸附失败诚实 not_snapped /
// 拓扑不连通与「无可通行边」两种空结果可区分 / 两口径同源汇总 / 几何去重拼接。
//
// 注：取档与寻路语义在 SQL 内（pgr_withPoints + cost_m/cost_min），属集成测试范畴
//（本地起 postgis 后 export V3_INTEGRATION_DB=1 联调）；此处 mock repository
// 验证 service 的编排与契约。

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
    repo.snapPoints.mockResolvedValue([])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    expect(r.mode).toBe('distance')
  })

  it('mode 为空串应回落 distance（兼容前端未传参）', async () => {
    repo.snapPoints.mockResolvedValue([])
    const r = await service.findPath({
      fromLng: 108.6,
      fromLat: 21.6,
      toLng: 108.7,
      toLat: 21.7,
      mode: '',
    })
    expect(r.mode).toBe('distance')
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

  it('吸附失败（附近无可通行边）→ 诚实 found:false，不硬吸远路', async () => {
    repo.snapPoints.mockResolvedValue([]) // 起终点任一未吸附即空
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    expect(r).toEqual({
      found: false,
      mode: 'distance',
      distanceM: 0,
      durationMin: 0,
      snapDistanceM: { from: 0, to: 0 },
      edgeCount: 0,
      coordinates: [],
    })
    // 未吸附即短路，不应发起寻路
    expect(repo.shortestPathByPoints).not.toHaveBeenCalled()
  })

  it('仅单侧吸附成功 → 同样 found:false（缺一不可）', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    expect(r.found).toBe(false)
  })

  it('有吸附点但无路径（拓扑不连通）→ found:false 但保留 snapDistanceM 供诊断', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.6, toLng: 108.7, toLat: 21.7 })
    expect(r.found).toBe(false)
    // 与「无可通行边」区分：此处吸附距离应保留（非 0）
    expect(r.snapDistanceM).toEqual({ from: 654.8, to: 629.1 })
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
    expect(r.found).toBe(true)
    expect(r.distanceM).toBe(16368.4)
    expect(r.durationMin).toBe(26.7)
    expect(r.edgeCount).toBe(3)
    expect(r.snapDistanceM).toEqual({ from: 654.8, to: 629.1 })
    // 相邻段重合点去重后 3 个点（而非 4 个）
    expect(r.coordinates).toEqual([
      [108.6, 21.7],
      [108.601979, 21.706018],
      [108.603089, 21.708101],
    ])
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
    expect(r.edgeCount).toBe(1)
    expect(repo.sumEdgeCosts).toHaveBeenCalledWith([3003])
  })

  it('几何全空（城市外）→ found:false（以坐标链是否非空为最终判据）', async () => {
    repo.snapPoints.mockResolvedValue([SNAP_FROM, SNAP_TO])
    repo.shortestPathByPoints.mockResolvedValue([
      { seq: 1, path_seq: 1, node: '55', edge: '3003', cost: 100, agg_cost: 0 },
    ])
    repo.sumEdgeCosts.mockResolvedValue({ distanceM: 100, durationMin: 0.1 })
    repo.pathGeometry.mockResolvedValue([])
    const r = await service.findPath({ fromLng: 108.6, fromLat: 21.7, toLng: 108.7, toLat: 21.75 })
    expect(r.found).toBe(false)
    expect(r.coordinates).toEqual([])
  })
})
