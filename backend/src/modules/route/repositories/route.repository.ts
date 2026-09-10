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

/**
 * 虚拟点编号（Points SQL 用**正数**）。
 *
 * ⚠️ **符号约定是 pgRouting 的硬要求，两处相反，写错会静默返回 0 行**：
 *   · Points SQL 的 `pid` 列 → 必须给**正数**。官方文档原文：
 *     "Use with positive value, as internally will be converted to negative value."
 *   · 函数入参 `start_pid` / `end_pid` → 必须给**负值**。文档原文：
 *     "Negative value is for point's identifier."
 *
 * 实测教训（2026-09-10，写在这里防止再犯）：原实现**两者都传负数**，
 * 于是起点标识与内部编号对不上，`pgr_withPoints` **不报错、直接返回 0 行**，
 * 表现为"任何起终点组合都 unreachable"（含 0 米同点、同边、跨城 100km，以及
 * 纯 VALUES 造的合成数据）——为此白排查了 4 轮服务器往返。
 * 可复用的排查手法：单点自环 `pgr_withPoints(edges, points, pid, pid)` 返回 0 行，
 * 即说明该点**没被注册**，这是最强的最小判据。
 */
export const PID_FROM = 1
export const PID_TO = 2

/** 吸附结果行（pid 为上面的正数常量） */
export interface SnapRow {
  pid: number
  edge_id: string
  fraction: number
  snap_m: number
}

/**
 * `pgr_withPoints` 返回行。
 *
 * 语义（2026-09-10 实测确认）：`edge` 是**从当前 node 出发所走的那条边**，`cost` 是
 * **该段实际费用**——首尾两条被吸附点切开的边，cost 已按 fraction 折算，不是整条边的
 * 费用。最后一行是终点哨兵：`edge = -1`、`cost = 0`，其 `agg_cost` 即总费用。
 */
export interface WithPointsRow {
  seq: number
  path_seq: number
  node: string
  edge: string
  cost: number
  agg_cost: number
  /** 该段所走边的拓扑起点顶点（用于判定行进方向） */
  edge_source: number | null
  /** 该段所走边的拓扑终点顶点 */
  edge_target: number | null
}

/** 路径分段：几何拼接与里程折算的最小单元 */
export interface RouteSegment {
  edgeId: number
  /** 该段在边内的起止比例（几何顺序，0..1） */
  lo: number
  hi: number
  /** 行进方向是否与边的数字方向相反（true → 拼接时坐标需反转） */
  reverse: boolean
  /** pgRouting 给出的该段实际费用（按所选口径） */
  cost: number
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
ORDER BY pid
`,
      [fromLng, fromLat, toLng, toLat, PID_FROM, PID_TO, maxSnapM]
    )
    return res.rows
  }

  /**
   * pgRouting 最短路（支持起终点落在边内任意位置）。
   *
   * 三处易错点（都踩过）：
   *   ① Points SQL 的 pid 用**正数**，函数入参 start/end 用**负数**（见 PID_FROM 注释）；
   *   ② 内层 edges_sql 必须用 `$$` 美元引用包裹——它含 `'b'::char` 这类单引号字面量，
   *      用 `'...'` 包裹会提前终止字符串（实测首次上线 5/5 全 500 即此因）；
   *   ③ 外层 `edge > 0` 只滤掉终点哨兵行（实测部分边的 `edge` 仍为正数、`cost` 已按
   *      fraction 折算），故**不能**靠它判断路径为空——真正的空结果是 0 行。
   * directed := false —— 对齐原实现 nx.Graph()（无向图；oneway 列源数据全 NULL）。
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
SELECT r.seq,
       r.path_seq,
       r.node::text AS node,
       r.edge::text AS edge,
       r.cost::float8 AS cost,
       r.agg_cost::float8 AS agg_cost,
       e.source AS edge_source,
       e.target AS edge_target
FROM pgr_withPoints(
  $$SELECT id, source, target, ${costCol} AS cost, ${costCol} AS reverse_cost
      FROM roads WHERE ${costCol} > 0 AND main_comp IS TRUE
      AND source IS NOT NULL AND target IS NOT NULL$$,
  $$${pointsSql}$$,
  $1::bigint, $2::bigint,
  directed := false
) r
LEFT JOIN roads e ON e.id = r.edge
WHERE r.edge > 0
ORDER BY r.path_seq
`,
      [-PID_FROM, -PID_TO]
    )
    return res.rows
  }

  /**
   * 按**分段实际费用**汇总两口径。
   *
   * 为什么不能用「整条边求和」：`pgr_withPoints` 的首尾两条边是被吸附点切开的**部分边**，
   * 其费用只算走过的一段。旧实现取整条边的 cost_m 相加，把没走的部分也算了进去——
   * 2026-09-10 实测样本（钦州 ~5.8km 路径）高估约 10.6%，直接顶穿 B-5 的 <1% 判据。
   *
   * 另一口径用**比例折算**（该段费用 ÷ 该边在所选口径下的全长 × 该边在另一口径下的全长），
   * 而非二次寻路——这样「两口径同源」才成立：同一条路径同时报距离与时长，不会出现
   * "距离按 A 路径、时长按 B 路径"。整条边时比例为 1，公式自动退化为直接取值。
   */
  async sumSegmentCosts(
    segments: RouteSegment[],
    mode: RouteMode
  ): Promise<{ distanceM: number; durationMin: number }> {
    if (segments.length === 0) return { distanceM: 0, durationMin: 0 }
    const modeCol = MODE_COST_COLUMN[mode]
    const otherCol = mode === 'distance' ? 'cost_min' : 'cost_m'
    const res = await this.db.query<{ mode_metric: number; other_metric: number }>(
      `
SELECT COALESCE(sum(t.cost), 0)::float8                                          AS mode_metric,
       COALESCE(sum(t.cost / NULLIF(r.${modeCol}, 0) * r.${otherCol}), 0)::float8 AS other_metric
FROM ROWS FROM (unnest($1::bigint[]), unnest($2::float8[])) AS t(edge_id, cost)
JOIN roads r ON r.id = t.edge_id
`,
      [segments.map((s) => s.edgeId), segments.map((s) => s.cost)]
    )
    const row = res.rows[0]
    const modeMetric = row?.mode_metric ?? 0
    const otherMetric = row?.other_metric ?? 0
    return mode === 'distance'
      ? { distanceM: modeMetric, durationMin: otherMetric }
      : { distanceM: otherMetric, durationMin: modeMetric }
  }

  /**
   * 取分段几何（按 lo~hi 截取，**几何顺序**输出；行进方向的反转由 service 层处理）。
   * 用 ST_LineSubstring 而非整条边：首尾两条只应画出真正走过的那一段，否则会"多画一截路"。
   * lo=0 / hi=1 时 ST_LineSubstring 等价于整条边。
   *
   * ⚠️ **`ST_DumpPoints` 的列别名必须给全三个**：它返回 `geometry_dump(path, geom)`，
   * 再叠加 `WITH ORDINALITY` 的序号列。写成 `AS dp(g, g_ord)` 会把 `g` 绑到 **`path`**
   * （integer[]）而不是几何上，于是 `ST_X(g)` 变成 `ST_X(integer[])` → 类型错误 → 500。
   * 该写法是迁移期留下的，因为当时 `pgr_withPoints` 恒返 0 行、几何拼接从未被执行而没暴露；
   * 2026-09-10 寻路修好后第一次跑到即 500（实测）。
   */
  async segmentGeometry(
    segments: RouteSegment[]
  ): Promise<Array<{ seq: number; coords: Array<[number, number]> | null }>> {
    if (segments.length === 0) return []
    const res = await this.db.query<{ seq: number; coords: Array<[number, number]> | null }>(
      `
SELECT t.ord::int AS seq,
       (SELECT array_agg(ARRAY[ST_X(dp.geom), ST_Y(dp.geom)] ORDER BY dp.ord)::float8[][]
        FROM ST_DumpPoints(ST_LineSubstring(r.geom, t.lo, t.hi))
             WITH ORDINALITY AS dp(path, geom, ord)
       ) AS coords
FROM ROWS FROM (unnest($1::bigint[]), unnest($2::float8[]), unnest($3::float8[]))
     WITH ORDINALITY AS t(edge_id, lo, hi, ord)
JOIN roads r ON r.id = t.edge_id
ORDER BY t.ord
`,
      [segments.map((s) => s.edgeId), segments.map((s) => s.lo), segments.map((s) => s.hi)]
    )
    return res.rows
  }

  /** 兜底：pgr_withPoints 无结果时的诊断——统计可通行边数（区分「拓扑未建」与「确实不连通」） */
  async countTraversableEdges(): Promise<number> {
    const res = await this.db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM roads WHERE cost_m > 0'
    )
    return Number(res.rows[0]?.n ?? 0)
  }
}
