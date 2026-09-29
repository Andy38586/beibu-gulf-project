-- access-factors.sql — 交通可达因子面物化（新选址准则「交通可达」；2026-09-29）
--
-- 口径（v1 直线距离代理）：每地形块到最近港口/最近道路的球面距离（米）。
-- pgRouting 路径级可达性（路网旅行时间）为后续升级，届时替换本表面而非并存。
-- KNN（<->）走 GiST；geography 口径（球面米）。
--
-- 用法：
--   docker cp tools/site-suitability/access-factors.sql beibu-postgis:/tmp/
--   docker exec beibu-postgis psql -U postgres -d beibu-gulf-data \
--     -v ON_ERROR_STOP=1 -f /tmp/access-factors.sql
--
-- 幂等：TRUNCATE + 重灌（源为库内 terrain_factors/ports/roads，无外部依赖）。
TRUNCATE access_factors;

INSERT INTO access_factors (terrain_id, dist_port_m, dist_road_m, geom)
SELECT
  t.id,
  (SELECT round(ST_Distance(t.geom::geography, p.geom::geography))::double precision
     FROM ports p ORDER BY p.geom <-> t.geom LIMIT 1),
  (SELECT round(ST_Distance(t.geom::geography, r.geom::geography))::double precision
     FROM roads r ORDER BY r.geom <-> t.geom LIMIT 1),
  t.geom
FROM terrain_factors t;
