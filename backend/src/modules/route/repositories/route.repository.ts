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
//   · time 口径     → cost_min （= 物理时间，分钟；选路另用 route_cost_min 加等级偏好）
//   · 吸附（起点/终点投影到最近边）→ ST_LineLocatePoint + KNN(<->)，对齐 _snap_query/_attach
//   · 不可通行边 cost = -1；v2 有单向边，故过滤谓词一律是 `cost > 0 OR reverse_cost > 0`
// 表结构、权重列与等级参数表由 tools/roads/roads-graph-build.sql 建立
//（v2：顶点 = OSM node id，有向图；旧 tools/roads/pgrouting-setup.sql 只服务已停用的旧管线）。

/**
 * mode → **选路权重列**（白名单，防注入）。
 *
 * v2 路网（2026-09-13）起，「选路权重」与「对外报告口径」解耦：
 *   · distance：纯距离（cost_m / reverse_cost_m）——"最短"就该是几何最短，不加偏好；
 *   · time    ：物理时间 × 等级偏好 × 通行限制惩罚（route_cost_min / route_reverse_cost_min）
 *               ——按纯物理时间选路会为省 200m 钻村道/穿小区，故给低等级道与受限通行道
 *               温和加权（route_class_profile.pref_penalty）；**报告的分钟数仍取物理
 *               cost_min**（见 MODE_METRIC），面板上的时长没有被放大。
 */
const MODE_WEIGHT = {
  distance: { cost: 'cost_m', reverseCost: 'reverse_cost_m' },
  time: { cost: 'route_cost_min', reverseCost: 'route_reverse_cost_min' },
} as const

export type RouteMode = keyof typeof MODE_WEIGHT

/** mode → 对外报告的物理口径列：永远报物理量（米 / 分钟），与选路权重无关 */
const MODE_METRIC = {
  distance: { metric: 'cost_m', other: 'cost_min' },
  time: { metric: 'cost_min', other: 'cost_m' },
} as const

export function isRouteMode(m: unknown): m is RouteMode {
  return typeof m === 'string' && Object.prototype.hasOwnProperty.call(MODE_WEIGHT, m)
}

/**
 * 路由实际使用的路网表。
 *
 * `roads_edges` 是 v2 路网（2026-09-13 质变上线）：顶点 = **OSM node id**，way 只在
 * 「被其他 way 共享的 node」处切分。它同时修掉旧管线的三处结构性缺陷：
 *
 *   ① **拓扑**：旧表 `roads_noded` 的顶点是「端点投影切分 + 60m 网格并点」造出的代理点——
 *      上跨/下穿的两条路只要离得近就被并成同一个顶点，于是在立交处凭空生出路口
 *      （桥上可以直接拐到桥下＝用户报的"下穿国道直接拐上高速"）。v2 里上跨/下穿不共享
 *      OSM node → 天然不连通，必须走匝道/路口，和真实世界一致。
 *   ② **单行**：旧表没有 reverse_cost 列，且源数据 oneway 全为 NULL（抽取阶段把属性丢了），
 *      pgr 一直以 directed := false 跑 → 高速双向可逆行。v2 抽到了 11 万条单向边
 *      （高速 99% 是单向），cost / reverse_cost 分开给，directed := true。
 *   ③ **等级**：v2 带 maxspeed 真值与等级缺省限速，时间口径才有真实梯度
 *      （motorway 110 / trunk 78 / primary 60 / residential 25 km/h）。
 *
 * 旧表 `roads_noded`（614,015 段，主分量 94.9%）保留在库里仅作回滚与 A/B 对照，
 * 不再被任何查询引用。回退只需把本常量改回 'roads_noded'（同时 directed 也要回退）。
 */
export const ROUTING_TABLE = 'roads_edges'

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
         -- ⚠️ fraction 必须夹离 1：点正落在边的**终点顶点**上时 ST_LineLocatePoint 返回恰 1.0，
         -- 而 pgr_withPoints 对 fraction=1 **不报错、静默返回 0 行** → 上层判成 unreachable
         --（"任何路网都走不通"）。2026-09-12 生产实测（北海国际客运港：周边 3km 最近边 f 全为
         -- 1.0，未夹 0 行；夹到 1-1e-6 后 248 行 / 114.8km）。港口/淹没设施点多贴着路段末端，
         -- 故必须有此夹取。fraction=0 侧 pgRouting 实测可用，两端的夹取仅为对称防御。
         -- 偏差 = 边长×1e-6（亚毫米级），不影响里程口径。
         LEAST(
           GREATEST(
             ST_LineLocatePoint(r.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490)),
             1e-6
           ),
           1 - 1e-6
         ) AS fraction,
         ST_Distance(
           r.geom::geography,
           ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490)::geography
         ) AS snap_m
  FROM pts p
  CROSS JOIN LATERAL (
    SELECT id, geom
    FROM ${ROUTING_TABLE}
    -- v2：单向边（oneway=-1）的 cost_m 是 -1，只按 cost_m > 0 过滤会把它们
    -- 排除出吸附面（反向单行路段两侧都吸不上点）。谓词与偏索引 idx_roads_edges_geom_usable 一致。
    WHERE cost_m > 0 OR reverse_cost_m > 0
    -- 注：main_comp IS TRUE 与上面的 OR 谓词共同构成偏索引两侧条件，
    --     这里保持书写与建图脚本【5】完全一致，便于 SQL 计划核对
    AND main_comp IS TRUE
    AND geom IS NOT NULL
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
   *
   * `directed := true`（v2 起）：单向边由 `reverse_cost = -1` 表达——pgRouting 的约定是
   * 「该方向的代价为负 = 该方向不存在」。旧实现传 `directed := false` + 无反向代价列，
   * 等价于把所有单行道当双向道（高速可逆行）。**这一处必须与 MODE_WEIGHT 的反向列成对修改**：
   * 只改 directed 不给 reverse_cost，pgr 会把 -1 当成"负代价的合法边"，反而选出负权路径。
   */
  async shortestPathByPoints(snaps: SnapRow[], mode: RouteMode): Promise<WithPointsRow[]> {
    const { cost: costCol, reverseCost: reverseCostCol } = MODE_WEIGHT[mode]
    // points_sql 内联：pid/edge_id/fraction 全部来自上一步吸附查询的结果行，
    // 经 Number() 归一后拼接（数值类型，不含用户原始输入，无注入面）；
    // 超 2^53 的标识经 Number 静默失真会指到错误边——fail-loud 优于静默错果（审查 L-5）
    const pointsSql = snaps
      .map((s) => {
        const pid = Number(s.pid)
        const edgeId = Number(s.edge_id)
        const fraction = Number(s.fraction)
        if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(edgeId)) {
          throw new Error(
            `shortestPathByPoints: 吸附结果整数标识超安全范围 pid=${s.pid} edge_id=${s.edge_id}`
          )
        }
        return `SELECT ${pid}::int AS pid, ${edgeId}::bigint AS edge_id, ${fraction}::float8 AS fraction, 'b'::char AS side`
      })
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
  $$SELECT id, source, target, ${costCol} AS cost, ${reverseCostCol} AS reverse_cost
      FROM ${ROUTING_TABLE}
     WHERE main_comp IS TRUE AND (${costCol} > 0 OR ${reverseCostCol} > 0)
       AND source IS NOT NULL AND target IS NOT NULL$$,
  $$${pointsSql}$$,
  $1::bigint, $2::bigint,
  directed := true
) r
LEFT JOIN ${ROUTING_TABLE} e ON e.id = r.edge
WHERE r.edge > 0
ORDER BY r.path_seq
`,
      [-PID_FROM, -PID_TO]
    )
    // bigint 列经 pg 返回的是字符串，与接口声明的 number 不符——在边界归一，
    // 防止下游拿它做 `===` 数值比较时踩"number === string 恒 false"的坑（2026-09-13 实测事故）
    return res.rows.map((r) => ({
      ...r,
      edge_source: r.edge_source === null ? null : Number(r.edge_source),
      edge_target: r.edge_target === null ? null : Number(r.edge_target),
    }))
  }

  /**
   * 按**分段实际费用**汇总两口径。
   *
   * 为什么不能用「整条边求和」：`pgr_withPoints` 的首尾两条边是被吸附点切开的**部分边**，
   * 其费用只算走过的一段。旧实现取整条边的 cost_m 相加，把没走的部分也算了进去——
   * 2026-09-10 实测样本（钦州 ~5.8km 路径）高估约 10.6%，直接顶穿 B-5 的 <1% 判据。
   *
   * 另一口径用**几何比例折算**（该段走过的比例 × 该边在另一口径下的全长），不二次寻路——
   * 这样「两口径同源」才成立：同一条路径同时报距离与时长，不会出现"距离按 A 路径、
   * 时长按 B 路径"。整条边时比例为 1，公式自动退化为直接取值。
   *
   * v2 起比例取自**分段的几何区间** (hi - lo)，而不再用 `t.cost ÷ 该边全长`：后者要求
   * pgr 返回的 cost 就是物理量，而 v2 的 time 口径给 pgr 的是**加权代价**
   * （route_cost_min = 物理时间 × 等级偏好），比例会被偏好乘数污染、把时长报大。
   * 几何比例与代价比例等价（同一段上 cost 与长度成正比），且与选路权重彻底解耦。
   */
  async sumSegmentCosts(
    segments: RouteSegment[],
    mode: RouteMode
  ): Promise<{ distanceM: number; durationMin: number }> {
    if (segments.length === 0) return { distanceM: 0, durationMin: 0 }
    const { metric, other } = MODE_METRIC[mode]
    const res = await this.db.query<{ mode_metric: number; other_metric: number }>(
      `
SELECT COALESCE(sum((t.hi - t.lo) * r.${metric}), 0)::float8 AS mode_metric,
       COALESCE(sum((t.hi - t.lo) * r.${other}), 0)::float8  AS other_metric
FROM ROWS FROM (unnest($1::bigint[]), unnest($2::float8[]), unnest($3::float8[]))
     AS t(edge_id, lo, hi)
JOIN ${ROUTING_TABLE} r ON r.id = t.edge_id
`,
      [segments.map((s) => s.edgeId), segments.map((s) => s.lo), segments.map((s) => s.hi)]
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
JOIN ${ROUTING_TABLE} r ON r.id = t.edge_id
ORDER BY t.ord
`,
      [segments.map((s) => s.edgeId), segments.map((s) => s.lo), segments.map((s) => s.hi)]
    )
    return res.rows
  }

  /** 兜底：pgr_withPoints 无结果时的诊断——统计可通行边数（区分「拓扑未建」与「确实不连通」） */
  async countTraversableEdges(): Promise<number> {
    const res = await this.db.query<{ n: string }>(
      // 双向任一方向可通行即计入（v2 有单向边：只数 cost_m > 0 会漏掉反向单行段）
      'SELECT count(*)::text AS n FROM ' + ROUTING_TABLE + ' WHERE cost_m > 0 OR reverse_cost_m > 0'
    )
    return Number(res.rows[0]?.n ?? 0)
  }
}
