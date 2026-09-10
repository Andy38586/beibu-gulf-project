import { Injectable } from '@nestjs/common'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import {
  PID_FROM,
  PID_TO,
  RouteMode,
  RouteRepository,
  type RouteSegment,
  type WithPointsRow,
} from '../repositories/route.repository'

// 路径规划业务层（route 域下沉，2026-09-10）
//
// 取代 backend/algorithm-service 的 route/service.py + graph.py。
// 响应结构**逐字段对齐** FastAPI 的 /route/path，使前端 useRouteApi 只需改 ENDPOINTS：
//   · found=true  → { found, mode, distanceM, durationMin, snapDistanceM: {from, to}, edgeCount, coordinates }
//   · found=false → { found, reason }   ← 合法空结果，**只有这两个字段**（见 RoutePathEmpty）
//
// 口径不变量（对齐 graph.py，勿破坏）：
//   · 「两口径同源」——同一条路径同时报 distanceM 与 durationMin，禁止
//     "距离按 A 路径、时长按 B 路径"混算；mode 只决定按哪条权重寻路。
//   · 吸附半径 2000m（graph.py:67 QUERY_SNAP_RADIUS_M）：海面/无路荒区点击
//     诚实返回 found=false，不硬吸远路。
//   · 空结果必须带 reason，且**不得**夹带 mode/distanceM 等字段——前端
//     schemas.ts:357-371 的 discriminatedUnion 只认 {found,reason}。
//   · 里程与时长取**分段实际费用**（首尾部分边按 fraction 折算），不是整条边求和——
//     见 RouteRepository.sumSegmentCosts 注释（旧口径高估约 10.6%）。

/** 对齐 graph.py 的 QUERY_SNAP_RADIUS_M */
const SNAP_RADIUS_M = 2000.0

/** 合法空结果的空因（取值与 graph.py:406/409/419 逐字一致） */
export type RouteEmptyReason = 'origin_not_snapped' | 'destination_not_snapped' | 'unreachable'

/** 寻路成功（字段集对齐 graph.py:431-437） */
export interface RoutePathFound {
  found: true
  mode: RouteMode
  distanceM: number
  durationMin: number
  snapDistanceM: { from: number; to: number }
  edgeCount: number
  coordinates: Array<[number, number]>
}

/**
 * 合法空结果（不可达 / 起终点未吸附）。
 *
 * ⚠️ **只有 `found` + `reason` 两个字段**，对齐 graph.py 原实现的
 * `{"found": False, "reason": "..."}`——Python 侧 test_route_graph.py:81/88 与
 * test_topology.py:75 用 `==` 精确断言该形状；前端 schemas.ts:357-371 的
 * discriminatedUnion 的 found:false 分支同样只接受这两个字段。
 * （迁移期曾额外带 mode/snapDistanceM 等字段「供诊断」，属自造的契约偏差，已去除。）
 */
export interface RoutePathEmpty {
  found: false
  reason: RouteEmptyReason
}

export type RoutePathResult = RoutePathFound | RoutePathEmpty

/**
 * 把 `pgr_withPoints` 的返回行翻译成「路径分段」。
 *
 * 行语义（2026-09-10 实测）：`edge` = **从当前 node 出发所走的边**；末行是终点哨兵
 * （`edge = -1`、`cost = 0`）。首段与末段是被吸附点切开的**部分边**，用 fraction 定
 * 截取区间；中间段是整条边。
 *
 * `reverse`：行进方向与边的数字方向相反时需反转坐标，否则拼出来的折线会来回跳。
 * 判定方式：出发顶点等于该边的 `source` 即为正向；首段没有出发顶点（它是吸附点），
 * 改看落地顶点是否等于该边的 `target`；起终点落在同一条边上时（首段即末段），
 * 方向由两个 fraction 的相对大小决定。
 */
export function buildSegments(
  rows: WithPointsRow[],
  fromFraction: number,
  toFraction: number
): RouteSegment[] {
  const segments: RouteSegment[] = []
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i]
    const edgeId = Number(cur.edge)
    if (!Number.isFinite(edgeId) || edgeId <= 0) continue // 终点哨兵行

    const next = rows[i + 1]
    const departure = Number(cur.node)
    const arrival = next ? Number(next.node) : null

    const isFirst = segments.length === 0
    const isLast = !next || !(Number(next.edge) > 0)

    let forward: boolean
    if (isFirst && isLast) {
      forward = fromFraction <= toFraction
    } else if (isFirst) {
      forward = arrival !== null && arrival === cur.edge_target
    } else {
      forward = departure === cur.edge_source
    }

    let lo = 0
    let hi = 1
    if (isFirst && isLast) {
      lo = Math.min(fromFraction, toFraction)
      hi = Math.max(fromFraction, toFraction)
    } else if (isFirst) {
      if (forward) {
        lo = fromFraction
      } else {
        hi = fromFraction
      }
    } else if (isLast) {
      if (forward) {
        hi = toFraction
      } else {
        lo = toFraction
      }
    }

    segments.push({ edgeId, lo, hi, reverse: !forward, cost: Number(cur.cost) || 0 })
  }
  return segments
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

    const empty = (reason: RouteEmptyReason): RoutePathResult => ({ found: false, reason })

    // ① 吸附：起终点投影到最近可通行边（对齐 _snap_query + _attach）
    const snaps = await this.routeRepository.snapPoints(
      fromLng,
      fromLat,
      toLng,
      toLat,
      SNAP_RADIUS_M
    )
    const snapFrom = snaps.find((s) => s.pid === PID_FROM)
    const snapTo = snaps.find((s) => s.pid === PID_TO)
    // 判定顺序与 graph.py:404-409 同序：先起点后终点，保证同一输入给出同一 reason
    if (!snapFrom) {
      // 附近无可通行边 → 诚实 not_snapped（不硬吸远路，与原实现一致）
      return empty('origin_not_snapped')
    }
    if (!snapTo) {
      return empty('destination_not_snapped')
    }
    const snapDistanceM = {
      from: Math.round(snapFrom.snap_m * 10) / 10,
      to: Math.round(snapTo.snap_m * 10) / 10,
    }

    // ② 寻路（pgr_withPoints：起终点可落在边内任意 fraction）
    const rows = await this.routeRepository.shortestPathByPoints([snapFrom, snapTo], mode)
    if (rows.length === 0) {
      // 有吸附点但无路径 → 拓扑不连通（对齐 graph.py:417-419 的 NetworkXNoPath 分支）
      // 与"无可通行边"用不同 reason 区分，前端据此出不同文案
      return empty('unreachable')
    }

    // ③ 行 → 分段（跳过终点哨兵；首尾部分边由 fraction 定区间）
    const segments = buildSegments(rows, snapFrom.fraction, snapTo.fraction)
    if (segments.length === 0) {
      return empty('unreachable')
    }

    // ④ 两口径同源：同一组分段分别汇总（另一口径按比例折算，不二次寻路）
    const sums = await this.routeRepository.sumSegmentCosts(segments, mode)

    // ⑤ 几何拼接（按 lo~hi 截取；reverse 的分段把坐标倒过来，保证首尾相接）
    const segCoords = await this.routeRepository.segmentGeometry(segments)
    const coordinates: Array<[number, number]> = []
    for (const item of segCoords) {
      const seg = segments[item.seq - 1]
      if (!seg) continue
      const pts = item.coords ?? []
      const ordered = seg.reverse ? [...pts].reverse() : pts
      for (const pt of ordered) {
        const last = coordinates[coordinates.length - 1]
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) coordinates.push(pt)
      }
    }

    if (coordinates.length === 0) {
      // 防御性兜底：路径存在却拼不出坐标（原 Python 实现不产生此情形）。
      // 仍走合法空结果而非抛错——保持「断链绝不 500」的语义。
      return empty('unreachable')
    }

    return {
      found: true,
      mode,
      distanceM: Math.round(sums.distanceM * 10) / 10,
      durationMin: Math.round(sums.durationMin * 10) / 10,
      snapDistanceM,
      edgeCount: segments.length,
      coordinates,
    }
  }
}
