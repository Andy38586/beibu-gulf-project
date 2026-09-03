-- v3 空间库 schema（P4 数据入库，T4.1/T4.2）
-- 存储坐标系 EPSG:4490 (CGCS2000)；数据源为 WGS84(4326)，中国区域厘米级一致，直接赋值存储
-- 用法: docker exec -i beibu-postgis psql -U postgres -d v3_dev -f /tmp/db-schema-gis.sql
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
  length_m DOUBLE PRECISION, -- 入库预计算（UTM48N 投影 ST_Length），构图免重算
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