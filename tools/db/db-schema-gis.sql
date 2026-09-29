-- v3 空间库 schema（P4 数据入库，T4.1/T4.2）
-- 存储坐标系 EPSG:4490 (CGCS2000)；数据源为 WGS84(4326)，中国区域厘米级一致，直接赋值存储
-- 用法: docker exec -i beibu-postgis psql -U postgres -d beibu-gulf-data -f /tmp/db-schema-gis.sql
--
-- 与 db-schema.sql（业务表）分文件：两类表演进频率不同，防互相污染。
-- 空间表可演进为独立分析库（route_cache / coverage_result 等）同属此域。

CREATE EXTENSION IF NOT EXISTS postgis;

-- ==================== 路网（T5.2 networkx 数据源） ====================
-- pgRouting 拓扑不建（v3 裁剪决策：路径引擎为 networkx，构图在应用侧；
-- 若上 pgRouting，source/target/cost/reverse_cost 等列才有意义——当前不需要）。

-- OSM 公路（~165k 条，83MB）
CREATE TABLE IF NOT EXISTS roads (
  id       BIGSERIAL PRIMARY KEY,
  osm_id   BIGINT,
  name     TEXT,
  class    TEXT,            -- 映射自源 highway（OSM 分类），路径权重分组依据
  length_m DOUBLE PRECISION, -- 入库预计算（大地线 ST_Length(geography)，构图免重算。
                             -- 初版按 UTM48N 投影算，因路网跨 48N/49N 两带长度会随
                             -- 分带选择漂移，已改大地线口径并重算存量）
  maxspeed INTEGER,          -- 源数据未带（默认 NULL）；time 权重走 class 限速系数表
  oneway   BOOLEAN,          -- 源数据未带（默认 NULL）；构图侧可额外交互
  geom     geometry(LineString, 4490)
);
CREATE INDEX IF NOT EXISTS idx_roads_geom ON roads USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_roads_class ON roads (class);

-- OSM 铁路（~9.5k 条）
CREATE TABLE IF NOT EXISTS railways (
  id     BIGSERIAL PRIMARY KEY,
  osm_id BIGINT,
  name   TEXT,
  class  TEXT,
  geom   geometry(LineString, 4490)
);
CREATE INDEX IF NOT EXISTS idx_railways_geom ON railways USING GIST (geom);

-- ==================== 运河与园区（选址/路径需求方） ====================
-- 平陆运河示意线（1 条，含 section/status 属性）
CREATE TABLE IF NOT EXISTS canal (
  id      BIGSERIAL PRIMARY KEY,
  name    TEXT,
  section TEXT,
  status  TEXT,
  geom    geometry(LineString, 4490)
);
CREATE INDEX IF NOT EXISTS idx_canal_geom ON canal USING GIST (geom);

-- 工业园区（~2.7k 个，Polygon → 统一转 MultiPolygon 入库）
CREATE TABLE IF NOT EXISTS industrial_zones (
  id     BIGSERIAL PRIMARY KEY,
  osm_id BIGINT,
  name   TEXT,
  geom   geometry(MultiPolygon, 4490)
);
CREATE INDEX IF NOT EXISTS idx_industrial_geom ON industrial_zones USING GIST (geom);

-- ==================== 红树林（时序空间，全时相） ====================
-- GMW_v3 时相：广西 bbox 裁剪后入库（全球 107 万要素不整入）。
-- 索引策略（2026-09-03 采纳评审修正）：year 低基数列（11 值）用 BTree、
-- geom 用 GiST 分开建——优化器可 BitmapAnd 合并两索引，比复合 GiST 更灵活；
-- area_km2 为预计算列，面积统计类查询免 ST_Area 全表扫。
CREATE TABLE IF NOT EXISTS mangroves (
  id       BIGSERIAL PRIMARY KEY,
  year     INT,
  area_km2 DOUBLE PRECISION,
  geom     geometry(MultiPolygon, 4490)
);
CREATE INDEX IF NOT EXISTS idx_mangroves_geom ON mangroves USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_mangroves_year ON mangroves (year);

-- ==================== 保护区（WDPA，中国区已裁剪） ====================
CREATE TABLE IF NOT EXISTS protected_areas (
  id        BIGSERIAL PRIMARY KEY,
  name      TEXT,
  desig_eng TEXT,          -- 保护类别（Ib/IV 等）
  geom      geometry(MultiPolygon, 4490)
);
CREATE INDEX IF NOT EXISTS idx_protected_geom ON protected_areas USING GIST (geom);
-- ==================== 土地覆盖（ESA WorldCover，新选址因子，2026-09-27） ====================
-- class 代码权威源：ESA WorldCover PUM v2.0——10 乔木林/20 灌木/30 草地/40 耕地/50 人造地表/
-- 60 裸地/70 冰雪/80 水体/90 湿地/95 红树林/100 苔藓。管线 tools/land-pipeline/
-- 01-worldcover-polygons.py（4 瓦片 vsicurl → 4490 裁 bbox → 30m mode 聚合 → 4 连通矢量化）。
-- 源 v200 在钦州湾外海 108.1-108.9E/21.0-21.3N 有官方 nodata=0 空洞（开海域，不产面不补值）
CREATE TABLE IF NOT EXISTS land_cover (
  id    BIGSERIAL PRIMARY KEY,
  class INT NOT NULL,
  geom  geometry(MultiPolygon, 4490)
);
CREATE INDEX IF NOT EXISTS idx_land_cover_geom ON land_cover USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_land_cover_class ON land_cover (class);
-- ==================== 地形因子面（新选址准则「高程地形」，2026-09-29） ====================
-- 480m 格（30m DEM 16×16 块聚合），陆像元统计；管线 tools/dem-pipeline/12-terrain-factors.py。
-- mean_elev/mean_slope 为块内陆像元均值，max_slope 块内最大，land_frac 陆像元占比
--（全海/无值块不入库）；源 = 海陆一体 DEM（landsea_utm48n.tif，2026-09-27 拼接产物）
CREATE TABLE IF NOT EXISTS terrain_factors (
  id             BIGSERIAL PRIMARY KEY,
  mean_elev_m    DOUBLE PRECISION,
  mean_slope_deg DOUBLE PRECISION,
  max_slope_deg  DOUBLE PRECISION,
  land_frac      DOUBLE PRECISION,
  geom           geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_terrain_factors_geom ON terrain_factors USING GIST (geom);
-- ==================== 交通可达因子面（新选址准则「交通可达」，2026-09-29） ====================
-- v1 直线距离代理：到最近港口/最近道路的球面距离（米），KNN 物化自 terrain_factors。
-- 管线 tools/site-suitability/access-factors.sql；pgRouting 路径级可达性为后续升级。
CREATE TABLE IF NOT EXISTS access_factors (
  terrain_id   BIGINT PRIMARY KEY,
  dist_port_m  DOUBLE PRECISION,
  dist_road_m  DOUBLE PRECISION,
  geom         geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_access_factors_geom ON access_factors USING GIST (geom);
-- ==================== 行政区划（淹没面陆域裁剪用，2026-09-12） ====================
-- 钦北防三市 12 区县面，与 frontend/public/data/site-selection/boundary.geojson 同源
--（前端行政区划图层同款数据），改任一侧必须同步。
-- 4326 直存：来源即 4326，且本表只与 4326 淹没面做 ST_Intersection，无 4490 交互
CREATE TABLE IF NOT EXISTS admin_boundary (
  adcode BIGINT PRIMARY KEY,
  name   TEXT,
  geom   geometry(MultiPolygon, 4326)
);

-- 12 区县预联合并集（单行）：PICK 取档查询按行 CROSS JOIN 此表做 ST_Intersection，
-- 联合在灌数时一次算好，查询零联合开销
CREATE TABLE IF NOT EXISTS admin_boundary_union (
  id   INT PRIMARY KEY,
  geom geometry(MultiPolygon, 4326)
);
