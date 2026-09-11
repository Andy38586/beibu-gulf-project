-- =============================================================================
-- roads 派生列回填 + 主干分量重算（可复现 / 幂等 / 不删数据 / 不改表结构）
-- =============================================================================
-- 为什么需要这个文件（2026-09-10）：
--   `source / target / main_comp` 三列此前是**服务器上一个临时脚本**
--   （/tmp/rebuild-grid.sql）的产物 —— 仓库里没有任何脚本，换机或重置即失效，
--   且 `main_comp` 的取值没有可追溯的来源（只留下一个「49,308 条」的结论）。
--   本文件把「权重 → 拓扑 → 主干分量」这条链路固化成可重跑的脚本。
--
-- 分工（两个文件，别搞混）：
--   · roads-derive.sql（本文件）      ：class / length_m / cost_m / cost_min 回填
--                                       + main_comp 重算 + 自检
--                                       → **可在生产库随时重跑**（不动几何、不改表结构）
--   · roads-topology-build.sql        ：从零重建 source / target（网格法，确定性）
--                                       → 仅换机、首次建库、或确认拓扑坏掉时跑
--
-- 前置：roads 已由 tools/gis-import/import-gis.ps1 从**原始 GeoJSON**
--       （桌面 `_北部湾项目\数据_\项目数据\路网\beibu-roads.geojson`，165,111 条）
--       导入；road_class_speed 已由 tools/roads/pgrouting-setup.sql 建好。
--
-- 用法（服务器，仓库目录下；psql 变量选表，默认 roads_noded = 实际路由表）：
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev                   < tools/roads/roads-derive.sql
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev -v tbl=roads      < tools/roads/roads-derive.sql
--
-- ⚠️ 2026-09-10 起**路由表是 roads_noded**（端点投影切分后的表），不是 roads。
--    对 roads 跑本脚本只是白算（它已不参与路由）；要改路由行为必须指向 roads_noded。
--
-- 安全：全部变更包在一个事务里；任一步报错即整体回滚（ON_ERROR_STOP）。
-- =============================================================================

\if :{?tbl}
\else
\set tbl roads_noded
\endif

\set ON_ERROR_STOP on
\timing on

\echo '===== 【0】前置检查（表：' :tbl '）====='
SELECT count(*)                                AS roads_total,
       count(*) FILTER (WHERE geom IS NULL)    AS geom_null,
       count(*) FILTER (WHERE source IS NULL)  AS source_null,
       count(*) FILTER (WHERE target IS NULL)  AS target_null
FROM :tbl;
SELECT count(*) AS road_class_speed_rows FROM road_class_speed;

BEGIN;

\echo '===== 【1】class / length_m 回填（对齐 import-gis.ps1:83-84）====='
-- 表名经 set_config 传进 DO 块：psql 变量在引号/dollar-quote 内**不会**插值，
-- DO 块也看不到 psql 变量，只能走会话级 GUC。写成 `EXECUTE 'UPDATE :tbl ...'`
-- 会拿 ':tbl' 当表名报语法错。
SELECT set_config('route_derive.tbl', :'tbl', false);

-- class 来自源数据的 highway 字段（重命名为业务语义）
DO $do$
DECLARE
  t text := current_setting('route_derive.tbl');
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = t AND column_name = 'highway'
  ) THEN
    EXECUTE format('UPDATE %I SET class = highway WHERE class IS DISTINCT FROM highway', t);
  ELSE
    RAISE NOTICE '% .highway 列不存在，跳过 class 回填（class 应已就绪）', t;
  END IF;
END
$do$;

-- 长度口径：大地线（geography），不依赖 UTM 分带 —— 路网跨 48N/49N 两带，
-- 用投影长度会随分带选择漂移。只在为空时算，避免每次重跑都全表重算。
UPDATE :tbl
   SET length_m = round(ST_Length(geom::geography)::numeric, 2)
 WHERE length_m IS NULL;

\echo '===== 【2】权重 cost_m / cost_min（对齐 graph.py 的 CLASS_SPEED_KMH）====='
-- 先按限速表匹配，再对未匹配项（含 class 为 NULL）走默认 30km/h。
-- 分两步写是为了让「默认兜底」显式可见 —— 单条 UPDATE ... FROM 会让未匹配行保持 NULL，
-- 而 NULL cost 的边会被 pgr_dijkstra **静默忽略**，属隐蔽故障。
UPDATE :tbl r SET
  cost_m   = CASE WHEN cs.traversable THEN round(r.length_m::numeric, 2) ELSE -1 END,
  cost_min = CASE WHEN cs.traversable
                  THEN round((r.length_m / 1000.0 / cs.speed_kmh * 60)::numeric, 4)
                  ELSE -1 END
FROM road_class_speed cs
WHERE cs.class = r.class;

UPDATE :tbl SET
  cost_m   = round(length_m::numeric, 2),
  cost_min = round((length_m / 1000.0 / 30 * 60)::numeric, 4)
WHERE cost_m IS NULL;

\echo '===== 【3】main_comp = 全量可通行边的【最大连通分量】====='
\echo '--- 3a) 测量：全量可通行边的分量结构（分量数 / 最大分量节点数 / 全部节点数）---'
WITH cc AS (
  SELECT node, component
  FROM pgr_connectedComponents(
    format('SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost
              FROM %I
             WHERE cost_m > 0 AND source IS NOT NULL AND target IS NOT NULL', :'tbl')
  )
)
SELECT count(*)        AS components,
       max(n)          AS biggest_nodes,
       sum(n)          AS all_nodes,
       round(100.0 * max(n) / sum(n), 1) AS biggest_pct
FROM (SELECT component, count(*) AS n FROM cc GROUP BY component) t;

\echo '--- 3b) 备查：回填前 main_comp 的分布 ---'
SELECT main_comp, count(*) AS edges,
       count(*) FILTER (WHERE cost_m > 0) AS traversable
FROM :tbl GROUP BY 1 ORDER BY 1 NULLS LAST;

\echo '--- 3c) 回填（先把旧标记清空，再按最大分量重打）---'
-- 为什么必须重算而不是沿用旧值：吸附与寻路都限定在主干分量内（业务约定：只在主连通块
-- 内提供服务），旧值是临时脚本产物、无可追溯来源，且只覆盖全量的 ~29.5%，
-- 会白白收窄"点击能吸附上"的范围。
UPDATE :tbl SET main_comp = FALSE WHERE main_comp IS DISTINCT FROM FALSE;

WITH cc AS (
  SELECT node, component
  FROM pgr_connectedComponents(
    format('SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost
              FROM %I
             WHERE cost_m > 0 AND source IS NOT NULL AND target IS NOT NULL', :'tbl')
  )
),
big AS (
  SELECT component FROM cc GROUP BY component ORDER BY count(*) DESC LIMIT 1
)
UPDATE :tbl r SET main_comp = TRUE
FROM cc JOIN big ON cc.component = big.component
WHERE cc.node = r.source;

\echo '--- 3d) 回填后：主干边数与覆盖 ---'
SELECT count(*)                                   AS main_comp_edges,
       count(*) FILTER (WHERE cost_m > 0)         AS main_comp_traversable,
       (SELECT count(*) FROM :tbl WHERE cost_m > 0) AS traversable_total,
       round(100.0 * count(*) FILTER (WHERE cost_m > 0)
             / NULLIF((SELECT count(*) FROM :tbl WHERE cost_m > 0), 0), 1) AS coverage_pct
FROM :tbl
WHERE main_comp IS TRUE;

\echo '===== 【4】索引 ====='
CREATE INDEX IF NOT EXISTS idx_roads_source   ON :tbl (source);
CREATE INDEX IF NOT EXISTS idx_roads_target   ON :tbl (target);
CREATE INDEX IF NOT EXISTS idx_roads_cost_m   ON :tbl (cost_m) WHERE cost_m > 0;
CREATE INDEX IF NOT EXISTS idx_roads_main_comp ON :tbl (main_comp);

\echo '===== 【5】自检（每行右侧是期望值）====='
SELECT count(*) AS cost_m_null FROM :tbl WHERE cost_m IS NULL;
--   期望 0：NULL cost 的边会被 pgr_dijkstra 静默忽略
SELECT count(*) AS untraversable FROM :tbl WHERE cost_m < 0;
--   期望 4382：对齐 graph.py 的 EXCLUDED_CLASSES（Python 侧日志同量级）
SELECT count(*) AS main_comp_null FROM :tbl WHERE main_comp IS NULL;
--   期望 0
SELECT count(*) AS traversable_without_main FROM :tbl WHERE cost_m > 0 AND main_comp IS NOT TRUE;
--   这是"吸附不到"的边数（正常应有值，但不是全部）

COMMIT;
\echo '===== 完成 ====='
