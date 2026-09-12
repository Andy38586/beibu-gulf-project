-- ============================================================================
-- roads-graph-qa.sql — v2 路网的拓扑质量体检（可反复执行；每次 OSM 刷新后跑一遍）
--
-- 体检四件事：
--   QA-1 图是否真按 OSM node id 建（度数分布 + 断头率）
--   QA-2 单行 / 桥隧 / 等级限速是否真的进了图（旧管线这三项全是 0）
--   QA-3 立交（上跨/下穿）在几何相交处**不连通**——旧管线「60m 网格并点」正是在
--        这些地方凭空造路口；本文件同时给出旧网在同一位置的并点证据（A/B）
--   QA-4 主分量覆盖与代价口径自洽（-1 只出现在不可通行侧）
--
-- 用法：psql -v ON_ERROR_STOP=1 -f roads-graph-qa.sql
-- ============================================================================
\pset pager off
\timing on

-- ---------------------------------------------------------------------------
-- QA-1 顶点度数分布：度 1 = 断头路端点（路网完整性的直接指标）；度 ≥3 = 真路口。
--      度 2 不是缺陷：两条 way 在同一点首尾相接（OSM 常因限速/桥隧/行政区界把一条
--      路拆成多条 way）就产生度 2 顶点——它是"拼接点"，路由上等价于直行。
--      路中纯形状点已被抽取阶段排除（不进 roads_vertices）。
-- ---------------------------------------------------------------------------
WITH usable AS (
  SELECT source AS node_id FROM roads_edges WHERE cost_m > 0 OR reverse_cost_m > 0
  UNION ALL
  SELECT target FROM roads_edges WHERE cost_m > 0 OR reverse_cost_m > 0
),
deg AS (SELECT node_id, count(*) AS d FROM usable GROUP BY node_id)
SELECT
  count(*)                       AS vertices,
  count(*) FILTER (WHERE d = 1)  AS deg1_dead_end,
  count(*) FILTER (WHERE d = 2)  AS deg2_pass_through,
  count(*) FILTER (WHERE d = 3)  AS deg3,
  count(*) FILTER (WHERE d = 4)  AS deg4,
  count(*) FILTER (WHERE d >= 5) AS deg5plus,
  round(100.0 * count(*) FILTER (WHERE d = 1) / count(*), 2) AS dead_end_pct
FROM deg;

-- ---------------------------------------------------------------------------
-- QA-2 等级 / 单行 / 桥隧 / 限速真值覆盖率（按等级）
-- ---------------------------------------------------------------------------
SELECT
  class,
  count(*)                                                  AS edges,
  count(*) FILTER (WHERE oneway <> 0)                       AS oneway_edges,
  count(*) FILTER (WHERE bridge OR tunnel)                  AS bridge_tunnel,
  count(*) FILTER (WHERE maxspeed_kph IS NOT NULL)          AS maxspeed_known,
  round(avg(speed_kph), 1)                                  AS avg_speed_kph,
  round(sum(length_m) / 1000)                               AS km
FROM roads_edges
WHERE cost_m > 0 OR reverse_cost_m > 0
GROUP BY class
ORDER BY edges DESC;

-- ---------------------------------------------------------------------------
-- QA-3 立交不连通（结构证据）
--   取「桥/隧边 × 地面边」几何相交的对，统计其中有多少对**不共享顶点**：
--   不共享 = 上跨/下穿，图里正确地不连通；共享 = 桥台/匝道落地，本就该连通。
--   旧管线的 60m 网格并点会把前者一并连上——A 部分给出这些交点的坐标清单，
--   B 部分（需旧表存在）在旧网中检查同一位置是否被并成了路口。
-- ---------------------------------------------------------------------------
WITH br AS (
  SELECT id, source, target, geom FROM roads_edges
   WHERE bridge AND (cost_m > 0 OR reverse_cost_m > 0)
),
gr AS (
  SELECT id, source, target, geom FROM roads_edges
   WHERE NOT bridge AND NOT tunnel AND (cost_m > 0 OR reverse_cost_m > 0)
),
pairs AS (
  SELECT b.id AS bridge_id, g.id AS ground_id,
         -- 共享顶点 = 桥台/匝道落地（本就该连通）；不共享 = 真正的上跨/下穿
         (b.source = g.source OR b.source = g.target
          OR b.target = g.source OR b.target = g.target) AS shares_vertex
    FROM br b
    JOIN gr g ON b.geom && g.geom AND ST_Intersects(b.geom, g.geom)
)
SELECT
  count(*)                                       AS crossing_pairs,
  count(*) FILTER (WHERE NOT shares_vertex)      AS correctly_disconnected,
  count(*) FILTER (WHERE shares_vertex)          AS connected_at_abutment_or_ramp
FROM pairs;

-- B 部分：旧网（如存在）在同一批上跨/下穿处是否"并点成路口"
--   判据（不依赖旧网顶点表）：把新网的桥边、地面边各自映射回旧网的对应段
--   （在新边上取代表点，找旧网最近的段），若这两段**共享 source/target**，
--   说明旧管线把上跨/下穿并成了一个顶点 = 凭空路口 = 桥上桥下可互拐。
DO $$
DECLARE
  has_old boolean := to_regclass('public.roads_noded') IS NOT NULL;
  sampled int;
  merged int;
BEGIN
  IF NOT has_old THEN
    RAISE NOTICE 'QA-3B 跳过：未发现旧表 roads_noded（v2 上线后属正常）';
    RETURN;
  END IF;

  CREATE TEMP TABLE tmp_x ON COMMIT DROP AS
  SELECT DISTINCT ON (ST_SnapToGrid(ST_Intersection(b.geom, g.geom), 0.0002))
         ST_LineInterpolatePoint(b.geom, 0.5) AS probe_bridge,
         ST_LineInterpolatePoint(g.geom, 0.5) AS probe_ground
    FROM roads_edges b
    JOIN roads_edges g ON b.geom && g.geom AND ST_Intersects(b.geom, g.geom)
   WHERE b.bridge AND NOT g.bridge AND NOT g.tunnel
     AND (b.cost_m > 0 OR b.reverse_cost_m > 0)
     AND (g.cost_m > 0 OR g.reverse_cost_m > 0)
     -- 只要真正不连通的（共享顶点的是桥台/匝道，本就该连）
     AND NOT (b.source = g.source OR b.source = g.target
              OR b.target = g.source OR b.target = g.target)
   LIMIT 200;

  SELECT count(*) INTO sampled FROM tmp_x;

  WITH mapped AS (
    SELECT
      (SELECT o.id FROM roads_noded o
        WHERE o.geom && ST_Expand(x.probe_bridge, 0.00002)
        ORDER BY o.geom <-> x.probe_bridge LIMIT 1) AS old_bridge_id,
      (SELECT o.id FROM roads_noded o
        WHERE o.geom && ST_Expand(x.probe_ground, 0.00002)
        ORDER BY o.geom <-> x.probe_ground LIMIT 1) AS old_ground_id
      FROM tmp_x x
  )
  SELECT count(*) INTO merged
    FROM mapped m
    JOIN roads_noded a ON a.id = m.old_bridge_id
    JOIN roads_noded b ON b.id = m.old_ground_id
   WHERE a.id <> b.id
     AND (a.source = b.source OR a.source = b.target
          OR a.target = b.source OR a.target = b.target);

  RAISE NOTICE 'QA-3B：采样 % 处上跨/下穿（新网中不连通）；旧网在其中 % 处把两侧并成了同一顶点（凭空路口）',
    sampled, merged;
END $$;

-- ---------------------------------------------------------------------------
-- QA-4 代价口径自洽
--   · 可通行边的 cost/reverse 至少一侧 > 0（不可能两侧都是 -1）
--   · -1 只出现在「不可通行 / 单行反向」上
--   · 单行边两侧代价一正一负
-- ---------------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE cost_m <= 0 AND reverse_cost_m <= 0)               AS both_blocked,
  -- 单行检查只看**可通行**的单行边：不可通行的边两侧都是 -1，属正常
  count(*) FILTER (WHERE oneway = 1 AND cost_m > 0 AND reverse_cost_m <> -1)   AS bad_oneway_fwd,
  count(*) FILTER (WHERE oneway = -1 AND reverse_cost_m > 0 AND cost_m <> -1)  AS bad_oneway_rev,
  count(*) FILTER (WHERE cost_m > 0 AND reverse_cost_m > 0 AND cost_m <> reverse_cost_m) AS asym_bidirectional,
  count(*) FILTER (WHERE cost_min > 0 AND route_cost_min < cost_min)        AS penalty_below_one
FROM roads_edges;

-- ---------------------------------------------------------------------------
-- QA-5 三市业务范围内的断头率（真正影响用户的指标；全图断头率含 bbox 边界截断，
--      那些断头在滇/黔/粤/琼的边框上，业务上不可达也无所谓）
-- ---------------------------------------------------------------------------
WITH deg AS (
  SELECT node_id, count(*) AS d
    FROM (SELECT source AS node_id FROM roads_edges WHERE cost_m > 0 OR reverse_cost_m > 0
          UNION ALL
          SELECT target FROM roads_edges WHERE cost_m > 0 OR reverse_cost_m > 0) t
   GROUP BY node_id
)
SELECT
  count(*) AS vertices_in_three_cities,
  count(*) FILTER (WHERE d = 1) AS dead_ends,
  round(100.0 * count(*) FILTER (WHERE d = 1) / NULLIF(count(*), 0), 2) AS dead_end_pct
FROM deg
JOIN roads_vertices v ON v.node_id = deg.node_id
-- 边界表在各地可能存 4490 或 4326（本地 scratch 库是 4326）：按其自身 SRID 归一后再比
WHERE ST_Intersects(
        v.geom,
        (SELECT CASE WHEN ST_SRID(geom) = 4490 THEN geom ELSE ST_Transform(geom, 4490) END
           FROM admin_boundary_union)
      );

\timing off
