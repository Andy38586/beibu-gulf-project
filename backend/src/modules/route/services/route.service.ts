import { Injectable } from '@nestjs/common'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { RouteMode, RouteRepository } from '../repositories/route.repository'

// 路径规划业务层（route 域下沉，2026-09-10）
//
// 取代 backend/algorithm-service 的 route/service.py + graph.py。
// 响应结构**逐字段对齐** FastAPI 的 /route/path，使前端 useRouteApi 只需改 ENDPOINTS：
//   { found, mode, distanceM, durationMin, snapDistanceM: {from, to}, edgeCount, coordinates }
//
// 口径不变量（对齐 graph.py，勿破坏）：
//   · 「两口径同源」——同一条路径同时报 distanceM 与 durationMin，禁止
//     "距离按 A 路径、时长按 B 路径"混算；mode 只决定按哪条权重寻路。
//   · 吸附半径 2000m（graph.py:67 QUERY_SNAP_RADIUS_M）：海面/无路荒区点击
//     诚实返回 found=false，不硬吸远路。

/** 对齐 graph.py 的 QUERY_SNAP_RADIUS_M */
const SNAP_RADIUS_M = 2000.0

export interface RoutePathResult {
  found: boolean
  mode: RouteMode
  distanceM: number
  durationMin: number
  snapDistanceM: { from: number; to: number }
  edgeCount: number
  coordinates: Array<[number, number]>
}

@Injectable()
export class RouteService {
  constructor(private readonly routeRepository: RouteRepository) {}

  /**
   * GET /route/path?fromLng=&fromLat=&toLng=&toLat=&mode=
   * mode：distance（默认）/ time。校验对齐 FastAPI 的参数语义（经纬度范围 + mode 白名单）。
   */
  async findPath(params: {
    fromLng: number
    fromLat: number
    toLng: number
    toLat: number
    mode?: string
  }): Promise<RoutePathResult> {
    const { fromLng, fromLat, toLng, toLat } = params
    const mode: RouteMode =
      params.mode === undefined || params.mode === '' ? 'distance' : (params.mode as RouteMode)

    if (mode !== 'distance' && mode !== 'time') {
      throw new BusinessError(
        ErrorCode.INVALID_PARAMS,
        `mode 必须为 distance / time，收到：${params.mode}`
      )
    }
    for (const [name, v, limit] of [
      ['fromLng', fromLng, 180],
      ['toLng', toLng, 180],
      ['fromLat', fromLat, 90],
      ['toLat', toLat, 90],
    ] as Array<[string, number, number]>) {
      if (!Number.isFinite(v) || Math.abs(v) > limit) {
        throw new BusinessError(ErrorCode.INVALID_PARAMS, `${name} 不是合法的经纬度数值`)
      }
    }

    const empty = (): RoutePathResult => ({
      found: false,
      mode,
      distanceM: 0,
      durationMin: 0,
      snapDistanceM: { from: 0, to: 0 },
      edgeCount: 0,
      coordinates: [],
    })

    // ① 吸附：起终点投影到最近可通行边（对齐 _snap_query + _attach）
    const snaps = await this.routeRepository.snapPoints(
      fromLng,
      fromLat,
      toLng,
      toLat,
      SNAP_RADIUS_M
    )
    const snapFrom = snaps.find((s) => s.pid === -1)
    const snapTo = snaps.find((s) => s.pid === -2)
    if (!snapFrom || !snapTo) {
      // 附近无可通行边 → 诚实 not_snapped（不硬吸远路，与原实现一致）
      return empty()
    }
    const snapDistanceM = {
      from: Math.round(snapFrom.snap_m * 10) / 10,
      to: Math.round(snapTo.snap_m * 10) / 10,
    }

    // ② 寻路（pgr_withPoints：起终点可落在边内任意 fraction）
    const rows = await this.routeRepository.shortestPathByPoints([snapFrom, snapTo], mode)
    if (rows.length === 0) {
      // 有吸附点但无路径 → 拓扑不连通（与"无可通行边"是两种情形，日志需可区分）
      return { ...empty(), snapDistanceM }
    }

    const edgeIds: number[] = []
    for (const r of rows) {
      const id = Number(r.edge)
      if (Number.isFinite(id) && id > 0) edgeIds.push(id)
    }

    // ③ 两口径同源：用同一组边分别汇总，绝不各自寻路
    const sums = await this.routeRepository.sumEdgeCosts(edgeIds)

    // ④ 几何拼接（首尾按吸附 fraction 截取，使端点落在真实吸附点而非边原生端点）
    const segs = await this.routeRepository.pathGeometry(
      edgeIds,
      snapFrom.fraction,
      snapTo.fraction
    )
    const coordinates: Array<[number, number]> = []
    for (const seg of segs) {
      for (const pt of seg.coords ?? []) {
        const last = coordinates[coordinates.length - 1]
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) coordinates.push(pt)
      }
    }

    return {
      found: coordinates.length > 0,
      mode,
      distanceM: Math.round(sums.distanceM * 10) / 10,
      durationMin: Math.round(sums.durationMin * 10) / 10,
      snapDistanceM,
      edgeCount: edgeIds.length,
      coordinates,
    }
  }
}
