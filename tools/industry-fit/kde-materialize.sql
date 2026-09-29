-- kde-materialize.sql — KDE 核密度网格物化（论文 W6-8 产业拟合；工单「KDE 手写 SQL」单元）
--
-- 手写核密度估计（PostGIS 无原生 KDE，官方 ticket #2894）：
--   mass_i = Σ_points v_p · (1/(2πh²)) · exp(−d²/(2h²))，d = 球面距离（米）
--   density_per_km2 = mass / cell_area_km2
-- 输出列：geom（网格面 4490）｜mass（期望点数/格）｜area_km2｜density_per_km2
--
-- 参数（psql -v，全部必填）：
--   src_table  点表名（如 poi_facilities）
--   src_geom   几何列名（如 geom）
--   src_value  权重表达式（列名或常数 1）
--   h_m        带宽（米）
--   cell_m     格网边长（米）
--   bbox_wkt   裁剪范围 POLYGON（4490）
--   out_table  输出表名（可带 pg_temp. 前缀做会话内测试）
--
-- 用法：
--   docker exec -i beibu-postgis psql -U postgres -d beibu-gulf-data \
--     -v src_table=poi_facilities -v src_geom=geom -v src_value=1 \
--     -v h_m=2000 -v cell_m=500 \
--     -v bbox_wkt='POLYGON((107.29 20.96,110.00 20.96,110.00 22.61,107.29 22.61,107.29 20.96))' \
--     -v out_table=kde_poi_h2000_c500 \
--     -f /tmp/kde-materialize.sql
--
-- 口径注记：
-- ①粗滤用度半径（分母 111320×0.92，取本区最大纬度 cos 再留余量），保证真实球面
--   距离 ≤ 截断半径的格心不漏；精确距离一律 ST_DistanceSphere（球 R=6370986）。
-- ②截断半径 3h：2D 高斯 3h 外质量 ≈1.1%，总量守恒校验按 ≤2% 容差（kde-verify.py）。
-- ③幂等：先 DROP 再建（物化语义，重跑覆盖）。
DROP TABLE IF EXISTS :out_table;
CREATE TABLE :out_table AS
WITH env AS (
  SELECT ST_GeomFromText(:'bbox_wkt', 4490) AS b
),
grid AS (
  SELECT g.geom AS cell, ST_Centroid(g.geom) AS center
  FROM env e, ST_SquareGrid(:cell_m / 111320.0, e.b) g
),
pts AS (
  SELECT (:src_geom)::geometry AS geom, (:src_value)::double precision AS v
  FROM :src_table
),
cand AS (
  SELECT c.cell, c.center, p.v,
         ST_DistanceSphere(c.center, p.geom) AS d_m
  FROM grid c
  JOIN pts p
    ON ST_DWithin(c.center, p.geom, (3 * :h_m) / 111320.0 / 0.92)
  WHERE ST_DistanceSphere(c.center, p.geom) <= 3 * :h_m
)
SELECT
  c.cell AS geom,
  SUM(c.v * exp(-(c.d_m * c.d_m) / (2 * :h_m * :h_m)) / (2 * pi() * :h_m * :h_m)) AS mass,
  ST_Area(c.cell::geography) / 1e6 AS area_km2,
  SUM(c.v * exp(-(c.d_m * c.d_m) / (2 * :h_m * :h_m)) / (2 * pi() * :h_m * :h_m))
    * 1e6 AS density_per_km2
FROM cand c
GROUP BY c.cell;
-- 索引不在本模板建：psql 变量无法拼接标识符（:out_table_geom_idx 会带空格），
-- 物化为常驻产品表后由消费端按需补 GIST（参照 db-schema-gis.sql 惯例）。
