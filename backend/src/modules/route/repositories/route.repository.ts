import { Injectable } from '@nestjs/common'

import { DbService } from '../../../infra/db/db.service'

// 路径规划数据访问（route 域下沉，2026-09-10）
//
// 取代 backend/algorithm-service 的 networkx 构图：原实现把 roads 全表
// （165,111 条折线）经 ST_AsBinary 拉进 Python 内存重建图——峰值 612MB、
// 预热 179.5s。本层改为 pgRouting 的按索引 SQL 查询。
//
// 口径对齐 route/graph.py（勿凭感觉改）：
//   · distance 口径 → cost_m   （= round(length_m, 2)）
//   · time 口径     → cost_min （= round(length_m/1000/speed*60, 4)）
//   · 吸附（起点/终点投影到最近边）→ ST_LineLocatePoint + KNN(<->)，对齐 _snap_query/_attach
//   · 不可通行边 cost = -1，故 edges_sql 一律带 `cost > 0` 过滤
// 权重列与限速表由 tools/pgrouting-setup.sql 建立（含 pgr_createTopology 拓扑）。

/** mode → 权重列名（对齐 graph.py 的 MODE_WEIGHT，白名单防注入） */
const MODE_COST_COLUMN = {
  distance: 'cost_m',
  time: 'cost_min',
} as const

export type RouteMode = keyof typeof MODE_COST_COLUMN

export function isRouteMode(m: unknown): m is RouteMode {
  return typeof m === 'string' && Object.prototype.hasOwnProperty.call(MODE_COST_COLUMN, m)
}

/** 吸附失败的哨兵：pgRouting 用负 pid 表示「虚拟点」（不在顶点表内的点） */
const PID_FROM = -1
const PID_TO = -2

/** pgr_withPoints 返回行（cost 与 agg_cost 均取自所选口径） */
interface WithPointsRow {
  seq: number
  path_seq: number
  node: string
  edge: string
  cost: number
  agg_cost: number
}

/** 吸附结果行 */
export interface SnapRow {
  pid: number
  edge_id: string
  fraction: number
  snap_m: number
}

@Injectable()
export class RouteRepository {
  constructor(private readonly db: DbService) {}

  /**
   * 起点/终点吸附到最近可通行边。
   * 对齐 graph.py 的 _snap_query（KNN 找最近边）+ _attach（沿边投影、按 fraction 切分）：
   *   ST_LineLocatePoint 返回 0~1 的投影位置（等价于 Python 侧算出的 r）；
   *   snap_m 用 geography 计算真实地面距离（对齐 QUERY_SNAP_RADIUS_M = 2000m 的语义）。
   * 返回空数组 = 附近无可通行边（诚实 not_snapped，不硬吸远路）。
   */
  async snapPoints(
    fromLng: number,
    fromLat: number,
    toLng: number,
    toLat: number,
    maxSnapM: number
  ): Promise<SnapRow[]> {
    const res = await this.db.query<SnapRow>(
      `
WITH pts(pid, lng, lat) AS (
  VALUES ($5::int, $1::float8, $2::float8), ($6::int, $3::float8, $4::float8)
),
nearest AS (
  SELECT p.pid, r.id AS edge_id,
         ST_LineLocatePoint(r.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490)) AS fraction,
         ST_Distance(
           r.geom::geography,
           ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490)::geography
         ) AS snap_m
  FROM pts p
  CROSS JOIN LATERAL (
    SELECT id, geom
    FROM roads
    WHERE cost_m > 0 AND main_comp IS TRUE AND geom IS NOT NULL
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490)
    LIMIT 1
  ) r
)
SELECT pid, edge_id, fraction::float8 AS fraction, snap_m::float8 AS snap_m
FROM nearest
WHERE snap_m <= $7::float8
ORDER BY pid DESC
`,
      [fromLng, fromLat, toLng, toLat, PID_FROM, PID_TO, maxSnapM]
    )
    return res.rows
  }

  /**
   * pgRouting 最短路（支持起终点在边内任意位置）。
   * pgr_withPoints 的 points_sql 由吸附结果内联构造，pid 用负数（虚拟点约定）。
   * directed := false —— 对齐原实现 nx.Graph()（无向图；oneway 列源数据全 NULL）。
   *
   * ⚠️ 内层 SQL 必须用 $$ 美元引用包裹：points_sql 含 'b'::char 这类单引号字面量，
   * 若用 '...' 单引号包裹，内层引号会与外层冲突致字符串提前终止 → SQL 语法错误 → 500
   *（实测：首次上线 5/5 请求全 500 即此因）。
   */
  async shortestPathByPoints(snaps: SnapRow[], mode: RouteMode): Promise<WithPointsRow[]> {
    const costCol = MODE_COST_COLUMN[mode]
    // points_sql 内联：pid/edge_id/fraction 全部来自上一步吸附查询的结果行，
    // 经 Number() 归一后拼接（数值类型，不含用户原始输入，无注入面）
    const pointsSql = snaps
      .map(
        (s) =>
          `SELECT ${Number(s.pid)}::int AS pid, ${Number(s.edge_id)}::bigint AS edge_id, ${Number(s.fraction)}::float8 AS fraction, 'b'::char AS side`
      )
      .join(' UNION ALL ')

    const res = await this.db.query<WithPointsRow>(
      `
SELECT seq, path_seq, node::text AS node, edge::text AS edge,
       cost::float8 AS cost, agg_cost::float8 AS agg_cost
FROM pgr_withPoints(
  $$SELECT id, source, target, ${costCol} AS cost, ${costCol} AS reverse_cost
      FROM roads WHERE ${costCol} > 0 AND main_comp IS TRUE
      AND source IS NOT NULL AND target IS NOT NULL$$,
  $$${pointsSql}$$,
  $1::bigint, $2::bigint,
  directed := false
)
WHERE edge > 0
ORDER BY path_seq
`,
      [PID_FROM, PID_TO]
    )
    return res.rows
  }

  /**
   * 取路径经过边的几何（按 pgr_withPoints 给出的 edge 顺序拼接）。
   * 用 ST_LineSubstring 按起终点 fraction 截取，使路径端点落在真实吸附点而非边的原生端点；
   * 首尾两段的 fraction 来自吸附结果（其余段取整条边）。
   */
  async pathGeometry(
    edgeIds: number[],
    fromFraction: number,
    toFraction: number
  ): Promise<Array<{ seq: number; coords: Array<[number, number]> }>> {
    if (edgeIds.length === 0) return []
    const res = await this.db.query<{ seq: number; coords: Array<[number, number]> }>(
      `
WITH ordered AS (
  SELECT edge_id, ord
  FROM unnest($1::bigint[]) WITH ORDINALITY AS t(edge_id, ord)
)
SELECT o.ord::int AS seq,
       (SELECT array_agg(ARRAY[ST_X(g), ST_Y(g)] ORDER BY g_ord)::float8[][]
        FROM ST_DumpPoints(
               CASE
                 WHEN o.ord = 1 AND $3::float8 > 0
                   THEN ST_LineSubstring(r.geom, $3::float8, 1.0)
                 WHEN o.ord = $4::int AND $2::float8 < 1
                   THEN ST_LineSubstring(r.geom, 0.0, $2::float8)
                 ELSE r.geom
               END
             ) WITH ORDINALITY AS dp(g, g_ord)
       ) AS coords
FROM ordered o
JOIN roads r ON r.id = o.edge_id
ORDER BY o.ord
`,
      [edgeIds, toFraction, fromFraction, edgeIds.length]
    )
    return res.rows
  }

  /**
   * 按边集汇总两口径（「两口径同源」的实现点）：同一组边分别求 distance 与 duration，
   * 而非各按自己的权重分别寻路。对齐 graph.py 注释「两口径字段分离，互不派生」。
   */
  async sumEdgeCosts(edgeIds: number[]): Promise<{ distanceM: number; durationMin: number }> {
    if (edgeIds.length === 0) return { distanceM: 0, durationMin: 0 }
    const res = await this.db.query<{ distance_m: number; duration_min: number }>(
      `
SELECT COALESCE(sum(r.cost_m), 0)::float8   AS distance_m,
       COALESCE(sum(r.cost_min), 0)::float8 AS duration_min
FROM unnest($1::bigint[]) AS t(id)
JOIN roads r ON r.id = t.id
`,
      [edgeIds]
    )
    const row = res.rows[0]
    return { distanceM: row?.distance_m ?? 0, durationMin: row?.duration_min ?? 0 }
  }

  /** 兜底：pgr_withPoints 无结果时的诊断——统计可通行边数（区分「拓扑未建」与「确实不连通」） */
  async countTraversableEdges(): Promise<number> {
    const res = await this.db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM roads WHERE cost_m > 0'
    )
    return Number(res.rows[0]?.n ?? 0)
  }
}
