-- =============================================================================
-- roads 拓扑重建（网格法 · 确定性 · 可复现）—— 取代 pgr_createTopology 容差吸附
-- =============================================================================
-- 用途（**只在换机 / 首次建库 / 确认拓扑坏掉时跑**）：
--   把 roads.source / roads.target 从零算出来，使整套路网拓扑不依赖任何服务器上的
--   临时脚本。
--
-- ⚠️ **不要在正在服务生产的路网上随手跑本脚本** —— 它会清空并重写 source/target。
--    正确姿势：先在**副本库**（或先 pg_dump 一份）跑通、比对连通性，再考虑上生产。
--    生产上日常只需要跑 tools/roads-derive.sql（那个不动拓扑）。
--
-- 为什么不用 pgr_createTopology（对齐既有教训，勿退回）：
--   它的容差吸附**依赖边的处理顺序** —— 同一份数据两次重建能得到不同拓扑
--   （2026-09-10 实测：246,941 vs 193,135 顶点），不可复现，连通性也更差。
--   本脚本改用「端点量化到 60m 网格」的确定性归并，语义对齐原 networkx 构图的
--   `SNAP_CELL_M = 60m`。
--
-- 为什么用整数格点而不是 ST_SnapToGrid 后比较几何相等：
--   浮点几何的相等比较不可靠；量化为整数格点 (cx, cy) 后比较是精确的、可排序的。
-- 为什么在 UTM 49N（EPSG:32649）上量化而不是直接按度数：
--   60m 在纬度方向 ≈0.00054°、经度方向（21.5°N）≈0.00058°，度数网格是各向异性的；
--   投影到米制再按 60 取整才是真正的等距网格。本项目港口/路网在 UTM 49 带内。
--
-- 前置：roads 已导入且 geom 非空；建议先跑 tools/roads-derive.sql 的回填步骤。
-- 用法（服务器，仓库目录下）：
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev < tools/roads-topology-build.sql
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

\echo '===== 【0】前置检查 ====='
SELECT count(*)                               AS roads_total,
       count(*) FILTER (WHERE geom IS NULL)   AS geom_null,
       count(*) FILTER (WHERE source IS NOT NULL) AS source_filled_before
FROM roads;
--   注意 source_filled_before：本脚本会覆盖它，跑之前先确认你知道自己在做什么。

BEGIN;

\echo '===== 【1】端点 → 整数格点（60m 网格，UTM 49N）====='
DROP TABLE IF EXISTS _ends;
CREATE TEMP TABLE _ends AS
SELECT r.id AS edge_id,
       's'::text AS which,
       round(ST_X(ST_Transform(ST_StartPoint(r.geom), 32649)) / 60)::bigint AS cx,
       round(ST_Y(ST_Transform(ST_StartPoint(r.geom), 32649)) / 60)::bigint AS cy
FROM roads r
WHERE r.geom IS NOT NULL AND NOT ST_IsEmpty(r.geom)
UNION ALL
SELECT r.id,
       'e'::text,
       round(ST_X(ST_Transform(ST_EndPoint(r.geom), 32649)) / 60)::bigint,
       round(ST_Y(ST_Transform(ST_EndPoint(r.geom), 32649)) / 60)::bigint
FROM roads r
WHERE r.geom IS NOT NULL AND NOT ST_IsEmpty(r.geom);

SELECT count(*) AS ends,
       (SELECT count(*) FROM (SELECT DISTINCT cx, cy FROM _ends) d) AS distinct_cells
FROM _ends;

\echo '===== 【2】格点 → 顶点编号（按坐标排序 ⇒ 确定性）====='
DROP TABLE IF EXISTS _nodes;
CREATE TEMP TABLE _nodes AS
SELECT row_number() OVER (ORDER BY cx, cy) AS node_id, cx, cy
FROM (SELECT DISTINCT cx, cy FROM _ends) d;

SELECT count(*) AS vertices FROM _nodes;

\echo '===== 【3】回填 roads.source / target ====='
UPDATE roads SET source = NULL, target = NULL;

UPDATE roads r
   SET source = n.node_id
  FROM _ends e
  JOIN _nodes n ON n.cx = e.cx AND n.cy = e.cy
 WHERE e.edge_id = r.id AND e.which = 's';

UPDATE roads r
   SET target = n.node_id
  FROM _ends e
  JOIN _nodes n ON n.cx = e.cx AND n.cy = e.cy
 WHERE e.edge_id = r.id AND e.which = 'e';

SELECT count(*)                                          AS total,
       count(*) FILTER (WHERE source IS NULL)            AS source_null,
       count(*) FILTER (WHERE target IS NULL)            AS target_null,
       count(*) FILTER (WHERE source = target)           AS self_loop_edges
FROM roads;
--   期望 source_null / target_null = 0（除非 geom 为空）
--   self_loop_edges 有值是正常的：一条自身闭合/极短的路会在同一格点起止

\echo '===== 【4】连通性快照（与 networkx 时代对照）====='
-- 原 networkx 构图日志：nodes 194,456 / largest_component_edge_ratio 0.9501
WITH cc AS (
  SELECT node, component
  FROM pgr_connectedComponents(
    $$SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost
        FROM roads
       WHERE cost_m > 0 AND source IS NOT NULL AND target IS NOT NULL$$
  )
)
SELECT count(*)                           AS components,
       max(n)                             AS biggest_nodes,
       sum(n)                             AS all_nodes,
       round(100.0 * max(n) / sum(n), 1)  AS biggest_pct
FROM (SELECT component, count(*) AS n FROM cc GROUP BY component) t;

CREATE INDEX IF NOT EXISTS idx_roads_source ON roads (source);
CREATE INDEX IF NOT EXISTS idx_roads_target ON roads (target);

COMMIT;
\echo '===== 完成：接着跑 tools/roads-derive.sql 重算 main_comp 与权重 ====='
