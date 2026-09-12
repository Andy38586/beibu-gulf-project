-- =============================================================================
-- roads 端点投影切分（复刻 algorithm-service/route/topology.py:split_at_endpoints）
-- + 网格法建拓扑 + 权重 + 主干分量 → 产出 **roads_noded**（新表，不动 roads）
-- =============================================================================
-- ⚠️ **已退役（2026-09-13，路网 v2）**
--    本脚本的「端点投影切分 + 60m 网格并点」被 v2 取代：v2 按 **OSM node id** 建图，
--    上跨/下穿天然不连通、单向边生效、等级限速可用 —— 见 tools/roads/roads-graph-build.sql。
--    60m 并点的实测缺陷（2026-09-13 A/B）：抽样 200 处上跨/下穿，旧网在其中 67 处把桥上
--    桥下并成同一顶点（凭空路口，即"下穿国道直接拐上高架"）。
--    保留本文件仅为历史取证与旧表回滚参考。
-- =============================================================================
-- 为什么需要它（2026-09-10 实测）：
--   OSM 源数据里纵向道路**不在路口切断**，横路的端点接在纵路的「中间顶点」上 ——
--   只合并"首末点精确重合"的构图策略抓不到这类 **T 型连接**，于是 16.5 万条边被切成
--   **56,418 个互不相通的碎块**，最大连通分量只占 **18.5% 节点 / 30.3% 可通行边**。
--   Python 侧 topology.py 的模块注释记着同一个数字：切分前「主分量占比 28.6%」，
--   切分后 networkx 日志是 `largest_component_edge_ratio = 0.9501`（95%）。
--
--   这解释了「服务覆盖从 95% 掉到 30%」——**不是数据坏了，是缺少拓扑切分**。
--
-- 两步才等价于 Python（不要只做第一步）：
--   ① 本脚本的【1】~【3】：按「他边端点的投影」把被穿越的边切开（topology.py 复刻）；
--   ② 本脚本的【4】：60m 网格归并顶点。切点坐标与横路端点**只是容差内接近、并不精确
--      重合**（横路端点离被穿越边最远 60m），所以必须靠网格把两者并成同一节点 ——
--      这正是 topology.py 里「切点坐标即横路端点坐标 → 下游 RoadGraph 的网格吸附自然
--      把它们合并为同一节点」那句话的意思。
--
-- 口径对齐（逐条照抄 topology.py，勿凭感觉改）：
--   · 容差 60m            —— graph.py:53 SNAP_CELL_M
--   · 度数换算参考纬度 21.8° —— graph.py:57 REFERENCE_LAT，_DEG_TO_M = 111320·cos(21.8°) ≈ 103359.6
--   · 端部投影不切分（f≈0 或 f≈1）—— topology.py:87 `inner = (ratios > 1e-9) & (ratios < 1-1e-9)`
--   · 段长按「子段平面长 / 全长平面长」比例分摊原 length_m —— topology.py:98
--     （保留大地线口径的总量，Σ段长 == 原边长）
--   · 粗筛宁大勿漏（度数缓冲），精判再折米 —— topology.py:67/81
--
-- 已知取舍（照抄 topology.py 的显式登记）：平行路误连——与 T 型连接无法仅凭几何区分，
-- 误连代价 ≤ 容差的对角捷径；调小容差会漏真连接。
--
-- 安全：**只新建 roads_noded，不修改 roads**；全部包在单事务里。
-- 用法（服务器，仓库目录下）：
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev < tools/roads/roads-noding.sql
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

\echo '===== 【0】切分前基线（当前生产状态）====='
WITH cc AS (
  SELECT node, component
  FROM pgr_connectedComponents(
    $$SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost
        FROM roads WHERE cost_m > 0 AND source IS NOT NULL AND target IS NOT NULL$$
  )
)
SELECT count(*)                          AS components,
       max(n)                            AS biggest_nodes,
       sum(n)                            AS all_nodes,
       round(100.0 * max(n) / sum(n), 1) AS biggest_pct
FROM (SELECT component, count(*) AS n FROM cc GROUP BY component) t;

BEGIN;

\echo '===== 【1】端点 → 切点（复刻 split_at_endpoints 第 1~3 步）====='
DROP TABLE IF EXISTS _cuts;
CREATE TEMP TABLE _cuts AS
WITH ends AS (
  SELECT r.id AS owner_id, ST_StartPoint(r.geom) AS pt
  FROM roads r WHERE r.geom IS NOT NULL AND NOT ST_IsEmpty(r.geom)
  UNION ALL
  SELECT r.id, ST_EndPoint(r.geom)
  FROM roads r WHERE r.geom IS NOT NULL AND NOT ST_IsEmpty(r.geom)
)
SELECT DISTINCT c.cut_id, c.f::float8 AS f
FROM ends e
CROSS JOIN LATERAL (
  SELECT r.id                                          AS cut_id,
         ST_LineLocatePoint(r.geom, e.pt)              AS f,
         ST_Distance(r.geom, e.pt)                     AS d_deg
  FROM roads r
  WHERE r.id <> e.owner_id
    AND r.geom && ST_Expand(e.pt, 0.00058)   -- 粗筛（≈60m，宁大勿漏）→ GiST 索引可用
) c
WHERE c.d_deg * 103359.6 <= 60                 -- 精判：度数折米 ≤ 容差
  AND c.f > 1e-9 AND c.f < 1 - 1e-9;           -- 端部投影不切（交给网格归并）

SELECT count(*) AS cut_points, count(DISTINCT cut_id) AS edges_to_cut FROM _cuts;

\echo '===== 【2】切点 → 区间（0→f1、f1→f2、…、fk→1）====='
DROP TABLE IF EXISTS _spans;
CREATE TEMP TABLE _spans AS
WITH ordered AS (
  SELECT cut_id, f, lag(f) OVER (PARTITION BY cut_id ORDER BY f) AS prev
  FROM _cuts
)
SELECT cut_id, 0.0::float8 AS lo, min(f) AS hi FROM _cuts GROUP BY cut_id
UNION ALL
SELECT cut_id, prev, f FROM ordered WHERE prev IS NOT NULL
UNION ALL
SELECT cut_id, max(f), 1.0::float8 FROM _cuts GROUP BY cut_id;

SELECT count(*) AS spans FROM _spans;

\echo '===== 【3】生成 roads_noded（未切分的边整条保留）====='
DROP TABLE IF EXISTS roads_noded;
CREATE TABLE roads_noded AS
SELECT row_number() OVER (ORDER BY u.old_id, u.lo) AS id,
       u.old_id, u.class, u.osm_id, u.name, u.highway, u.length_m, u.geom
FROM (
  SELECT r.id AS old_id, r.class, r.osm_id, r.name, r.highway,
         -- 段长按平面长度比例分摊原大地线 length_m ⇒ Σ段长 == 原边长
         round((r.length_m * ST_Length(ST_LineSubstring(r.geom, s.lo, s.hi))
                / NULLIF(ST_Length(r.geom), 0))::numeric, 2) AS length_m,
         ST_LineSubstring(r.geom, s.lo, s.hi) AS geom,
         s.lo
  FROM _spans s
  JOIN roads r ON r.id = s.cut_id
  WHERE s.hi - s.lo > 1e-9
  UNION ALL
  SELECT r.id, r.class, r.osm_id, r.name, r.highway, r.length_m, r.geom, 0.0
  FROM roads r
  WHERE r.geom IS NOT NULL AND NOT ST_IsEmpty(r.geom)
    AND r.id NOT IN (SELECT DISTINCT cut_id FROM _cuts)
) u;

SELECT count(*) AS noded_edges FROM roads_noded;

\echo '===== 【4】网格法建拓扑（60m 整数格点 / UTM 49N；确定性）====='
ALTER TABLE roads_noded ADD COLUMN source INTEGER;
ALTER TABLE roads_noded ADD COLUMN target INTEGER;

DROP TABLE IF EXISTS _ends2;
CREATE TEMP TABLE _ends2 AS
SELECT n.id AS edge_id, 's'::text AS which,
       round(ST_X(ST_Transform(ST_StartPoint(n.geom), 32649)) / 60)::bigint AS cx,
       round(ST_Y(ST_Transform(ST_StartPoint(n.geom), 32649)) / 60)::bigint AS cy
FROM roads_noded n
UNION ALL
SELECT n.id, 'e'::text,
       round(ST_X(ST_Transform(ST_EndPoint(n.geom), 32649)) / 60)::bigint,
       round(ST_Y(ST_Transform(ST_EndPoint(n.geom), 32649)) / 60)::bigint
FROM roads_noded n;

DROP TABLE IF EXISTS _nodes2;
CREATE TEMP TABLE _nodes2 AS
SELECT row_number() OVER (ORDER BY cx, cy) AS node_id, cx, cy
FROM (SELECT DISTINCT cx, cy FROM _ends2) d;

UPDATE roads_noded r SET source = n.node_id
  FROM _ends2 e JOIN _nodes2 n ON n.cx = e.cx AND n.cy = e.cy
 WHERE e.edge_id = r.id AND e.which = 's';
UPDATE roads_noded r SET target = n.node_id
  FROM _ends2 e JOIN _nodes2 n ON n.cx = e.cx AND n.cy = e.cy
 WHERE e.edge_id = r.id AND e.which = 'e';

SELECT count(*) AS vertices FROM _nodes2;
SELECT count(*) AS total, count(*) FILTER (WHERE source IS NULL) AS source_null
FROM roads_noded;

\echo '===== 【5】权重（对齐 graph.py 的 CLASS_SPEED_KMH）====='
ALTER TABLE roads_noded ADD COLUMN cost_m DOUBLE PRECISION;
ALTER TABLE roads_noded ADD COLUMN cost_min DOUBLE PRECISION;

UPDATE roads_noded r SET
  cost_m   = CASE WHEN cs.traversable THEN round(r.length_m::numeric, 2) ELSE -1 END,
  cost_min = CASE WHEN cs.traversable
                  THEN round((r.length_m / 1000.0 / cs.speed_kmh * 60)::numeric, 4)
                  ELSE -1 END
FROM road_class_speed cs
WHERE cs.class = r.class;

UPDATE roads_noded SET
  cost_m   = round(length_m::numeric, 2),
  cost_min = round((length_m / 1000.0 / 30 * 60)::numeric, 4)
WHERE cost_m IS NULL;

\echo '===== 【6】★ 切分后连通性（与【0】对比，这是本次改造的核心读数）====='
WITH cc AS (
  SELECT node, component
  FROM pgr_connectedComponents(
    $$SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost
        FROM roads_noded
       WHERE cost_m > 0 AND source IS NOT NULL AND target IS NOT NULL$$
  )
)
SELECT count(*)                          AS components,
       max(n)                            AS biggest_nodes,
       sum(n)                            AS all_nodes,
       round(100.0 * max(n) / sum(n), 1) AS biggest_pct
FROM (SELECT component, count(*) AS n FROM cc GROUP BY component) t;
--   期望：components 从 56,418 数量级大幅下降、biggest_pct 从 18.5% 向 95% 逼近

\echo '===== 【7】main_comp = 全量可通行边的最大连通分量 ====='
ALTER TABLE roads_noded ADD COLUMN main_comp BOOLEAN;
UPDATE roads_noded SET main_comp = FALSE;

WITH cc AS (
  SELECT node, component
  FROM pgr_connectedComponents(
    $$SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost
        FROM roads_noded
       WHERE cost_m > 0 AND source IS NOT NULL AND target IS NOT NULL$$
  )
),
big AS (
  SELECT component FROM cc GROUP BY component ORDER BY count(*) DESC LIMIT 1
)
UPDATE roads_noded r SET main_comp = TRUE
FROM cc JOIN big ON cc.component = big.component
WHERE cc.node = r.source;

SELECT count(*)                                       AS noded_edges,
       count(*) FILTER (WHERE cost_m > 0)             AS traversable,
       count(*) FILTER (WHERE main_comp IS TRUE)      AS main_comp_edges,
       count(*) FILTER (WHERE main_comp AND cost_m > 0) AS main_comp_traversable,
       round(100.0 * count(*) FILTER (WHERE main_comp AND cost_m > 0)
             / NULLIF(count(*) FILTER (WHERE cost_m > 0), 0), 1) AS coverage_pct
FROM roads_noded;

\echo '===== 【8】索引 ====='
CREATE INDEX IF NOT EXISTS idx_roads_noded_geom   ON roads_noded USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_roads_noded_source ON roads_noded (source);
CREATE INDEX IF NOT EXISTS idx_roads_noded_target ON roads_noded (target);
CREATE INDEX IF NOT EXISTS idx_roads_noded_cost_m ON roads_noded (cost_m) WHERE cost_m > 0;
CREATE INDEX IF NOT EXISTS idx_roads_noded_main   ON roads_noded (main_comp);
CREATE INDEX IF NOT EXISTS idx_roads_noded_old    ON roads_noded (old_id);
-- 2026-09-12 生产事故（route 26s）后补：本表是 CREATE TABLE AS 产物、无主键，
-- 以下两索引是路由查询的性能前提，删掉即回到「每次查询全堆扫描 765MB」：
--   · id       —— 三处 `JOIN roads_noded ON id = ...` 的点查路径
--   · routing  —— 覆盖索引（谓词与 edges_sql 逐字一致），构图走 index-only
CREATE INDEX IF NOT EXISTS idx_roads_noded_id ON roads_noded (id);
CREATE INDEX IF NOT EXISTS idx_roads_noded_routing
  ON roads_noded (id) INCLUDE (source, target, cost_m, cost_min)
  WHERE cost_m > 0 AND main_comp IS TRUE AND source IS NOT NULL AND target IS NOT NULL;

COMMIT;

-- index-only scan 依赖 visibility map：VACUUM 不可省，且不能进事务块。
-- 并行 VACUUM 会撞 docker 默认 64MB /dev/shm（shared memory segment 分配失败），先关并行。
SET max_parallel_maintenance_workers = 0;
VACUUM (ANALYZE) roads_noded;

\echo '===== 完成 ====='
\echo 'roads 未被改动；结果在 roads_noded。'
\echo '若【6】的 biggest_pct 明显改善，再决定是否把 roads 换成 roads_noded（需另写切换脚本）。'
