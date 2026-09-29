-- materialize-cells.sql — 选址统一因子格网物化（单元二→四拼表；2026-09-29）
--
-- 一行 = 一个 480m 地形块：terrain_factors 主体 + 点所在 land_cover 主类
-- + access_factors 两列 + 包含块的 KDE 需求质量。全部点查走 GiST LATERAL。
-- 用法：
--   docker cp tools/site-suitability/materialize-cells.sql beibu-postgis:/tmp/
--   docker exec beibu-postgis psql -U postgres -d beibu-gulf-data \
--     -v ON_ERROR_STOP=1 -f /tmp/materialize-cells.sql
-- 幂等：TRUNCATE + 重灌（源全在库内）。worldcover 空洞（钦州湾外海）块
-- land_class 为 NULL——显式口径，端点侧按缺因子处理而非静默补值（04-B7）。
TRUNCATE suitability_cells;

INSERT INTO suitability_cells
  (id, geom, mean_elev_m, mean_slope_deg, max_slope_deg, land_frac,
   land_class, dist_port_m, dist_road_m, kde_mass)
SELECT
  t.id, t.geom, t.mean_elev_m, t.mean_slope_deg, t.max_slope_deg, t.land_frac,
  lc.class, a.dist_port_m, a.dist_road_m, k.mass
FROM terrain_factors t
LEFT JOIN LATERAL (
  SELECT c.class FROM land_cover c WHERE ST_Contains(c.geom, t.geom) LIMIT 1
) lc ON true
LEFT JOIN access_factors a ON a.terrain_id = t.id
LEFT JOIN LATERAL (
  SELECT k.mass FROM kde_indzone_h2000_c500 k WHERE ST_Contains(k.geom, t.geom) LIMIT 1
) k ON true;
