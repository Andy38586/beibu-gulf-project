-- =============================================================================
-- route 寻路验收脚本（可复用；A/B 对比任一张路网表）
-- =============================================================================
-- 用途：
--   ① 切换前验证：拿**应用同款 SQL**（吸附 → pgr_withPoints → 里程汇总）在候选表上
--      跑固定点对，与生产现值对比，确认结果合理再切；
--   ② B-5 精度验收：与 FastAPI 基线对照。
--
-- 用法（psql 变量选表，默认 roads_noded）：
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev -v tbl=roads        < tools/route-verify.sql
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev -v tbl=roads_noded  < tools/route-verify.sql
--
-- 为什么要有它：2026-09-10 的教训——「验收脚本在会话里」= 丢失。凡判据脚本一律入库。
--
-- 口径说明（与应用一致，勿改）：
--   · 吸附限定 `cost_m > 0 AND main_comp IS TRUE`，半径 2000m，KNN 取最近边
--   · Points SQL 的 pid 用**正数**(1/2)，pgr_withPoints 入参用**负数**(-1/-2)
--   · 里程 = pgr_withPoints 末行 agg_cost（分段实际费用，首尾部分边已按 fraction 折算）
-- =============================================================================

\pset pager off

\if :{?tbl}
\else
\set tbl roads_noded
\endif

\echo '=== V0) 目标表结构自检 ==='
SELECT count(*)                                             AS edges,
       count(*) FILTER (WHERE NOT ST_IsValid(geom))         AS invalid_geom,
       count(*) FILTER (WHERE ST_IsEmpty(geom))             AS empty_geom,
       count(*) FILTER (WHERE source IS NULL OR target IS NULL) AS null_topo,
       count(*) FILTER (WHERE cost_m > 0 AND main_comp IS TRUE) AS routable_edges
FROM :tbl;

\echo '=== V1) 四个点的吸附情况（含"旧基线起"——它在 roads 上吸附不上）==='
DROP TABLE IF EXISTS _vs;
CREATE TEMP TABLE _vs AS
SELECT p.lbl, p.pid, r.id AS edge_id,
       ST_LineLocatePoint(r.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490))::float8 AS f,
       round(ST_Distance(r.geom::geography,
             ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490)::geography)::numeric, 1) AS snap_m
FROM (VALUES
  ('钦州起',              1, 108.63::float8, 21.95::float8),
  ('钦州终',              2, 108.65::float8, 21.93::float8),
  ('北海终',              3, 109.12::float8, 21.48::float8),
  ('旧基线起(曾吸附不上)', 4, 108.60::float8, 21.70::float8)
) p(lbl, pid, lng, lat)
CROSS JOIN LATERAL (
  SELECT id, geom FROM :tbl
  WHERE cost_m > 0 AND main_comp IS TRUE AND geom IS NOT NULL
  ORDER BY geom <-> ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490)
  LIMIT 1
) r;

SELECT lbl, pid, edge_id, round(f::numeric, 4) AS fraction, snap_m,
       (snap_m <= 2000) AS snappable
FROM _vs ORDER BY pid;

\echo '=== V2) 钦州两点的路由（生产现值 ≈ distanceM 5841.8 / durationMin 8.2）==='
SELECT 'distance' AS mode, count(*) AS rows,
       round(max(agg_cost)::numeric, 1) AS metric
FROM pgr_withPoints(
  format('SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost FROM %I
           WHERE cost_m > 0 AND main_comp IS TRUE AND source IS NOT NULL AND target IS NOT NULL', :'tbl'),
  (SELECT string_agg(txt, ' UNION ALL ') FROM (
     SELECT format('SELECT %s::int AS pid, %s::bigint AS edge_id, %s::float8 AS fraction, ''b''::char AS side',
                   row_number() OVER (ORDER BY pid)::int, edge_id, f) AS txt
     FROM _vs WHERE pid IN (1, 2)) s),
  -1, -2, directed := false)
UNION ALL
SELECT 'time', count(*), round(max(agg_cost)::numeric, 1)
FROM pgr_withPoints(
  format('SELECT id, source, target, cost_min AS cost, cost_min AS reverse_cost FROM %I
           WHERE cost_min > 0 AND main_comp IS TRUE AND source IS NOT NULL AND target IS NOT NULL', :'tbl'),
  (SELECT string_agg(txt, ' UNION ALL ') FROM (
     SELECT format('SELECT %s::int AS pid, %s::bigint AS edge_id, %s::float8 AS fraction, ''b''::char AS side',
                   row_number() OVER (ORDER BY pid)::int, edge_id, f) AS txt
     FROM _vs WHERE pid IN (1, 2)) s),
  -1, -2, directed := false);

\echo '=== V3) 跨城 钦州→北海（生产现值 ≈ distanceM 259938.9 / durationMin 193）==='
SELECT 'distance' AS mode, count(*) AS rows,
       round(max(agg_cost)::numeric, 1) AS metric
FROM pgr_withPoints(
  format('SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost FROM %I
           WHERE cost_m > 0 AND main_comp IS TRUE AND source IS NOT NULL AND target IS NOT NULL', :'tbl'),
  (SELECT string_agg(txt, ' UNION ALL ') FROM (
     SELECT format('SELECT %s::int AS pid, %s::bigint AS edge_id, %s::float8 AS fraction, ''b''::char AS side',
                   row_number() OVER (ORDER BY pid)::int, edge_id, f) AS txt
     FROM _vs WHERE pid IN (1, 3)) s),
  -1, -2, directed := false);

\echo '=== V4) 旧基线点对 108.6,21.7 → 108.65,21.93（在 roads 上起点吸附不上）==='
-- pid 3 的终点换成 108.65,21.93 需重算，这里直接用 _vs 的 pid=4 作起点、pid=2 作终点
SELECT 'distance' AS mode, count(*) AS rows,
       round(max(agg_cost)::numeric, 1) AS metric
FROM pgr_withPoints(
  format('SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost FROM %I
           WHERE cost_m > 0 AND main_comp IS TRUE AND source IS NOT NULL AND target IS NOT NULL', :'tbl'),
  (SELECT string_agg(txt, ' UNION ALL ') FROM (
     SELECT format('SELECT %s::int AS pid, %s::bigint AS edge_id, %s::float8 AS fraction, ''b''::char AS side',
                   row_number() OVER (ORDER BY pid)::int, edge_id, f) AS txt
     FROM _vs WHERE pid IN (2, 4)) s),
  -1, -2, directed := false);

\echo '=== 完成（表：' :tbl '）==='
