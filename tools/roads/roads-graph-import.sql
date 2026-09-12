-- ============================================================================
-- roads-graph-import.sql — v2 路网的「原始装载」步骤：建 raw 表 + \copy 灌入
--
-- 为什么不用 ogr2ogr：本地库容器（postgis/postgis:16-3.4）未装 GDAL，且无宿主挂载。
-- 抽取产物同时给了 GeoJSON（人/QGIS 看）与 TSV（机器灌），这里吃 TSV。
--
-- 前置：宿主把两份 TSV 拷进容器 /tmp（见 tools/roads/import-roads-graph.ps1）
-- 用法：docker exec -i <容器> psql -U postgres -d <库> -v ON_ERROR_STOP=1 -f /tmp/roads-graph-import.sql
-- ============================================================================
\set ON_ERROR_STOP on
\timing on

BEGIN;

-- 原始边：一行 = 一段（way 在真路口处切开后的产物），几何以 WKT 承载（EPSG:4326）
DROP TABLE IF EXISTS roads_edges_raw;
CREATE TABLE roads_edges_raw (
  osm_way_id    bigint   NOT NULL,       -- OSM way id
  seg           int      NOT NULL,       -- 段序号（way 内）
  from_node     bigint   NOT NULL,       -- OSM node id（起点）
  to_node       bigint   NOT NULL,       -- OSM node id（终点）
  highway       text     NOT NULL,       -- 等级（原样保留 OSM 值）
  name          text,
  ref           text,                    -- 路号（G75、S40…）
  oneway        smallint NOT NULL,       -- 1 正向 / -1 反向 / 0 双向
  bridge        smallint NOT NULL,
  tunnel        smallint NOT NULL,
  layer         int      NOT NULL,
  maxspeed      int,                     -- km/h 真值（可能为 NULL）
  lanes         text,
  surface       text,
  toll          text,
  access        text,
  junction      text,                    -- roundabout 等
  motor_vehicle text,                    -- 比 access 更具体
  vehicle       text,
  node_count    int,                     -- 段内节点数（含两端）
  wkt           text     NOT NULL        -- LINESTRING(lon lat, …) EPSG:4326
);

-- 原始顶点：一行 = 一个路口/端点（OSM node id 即图顶点 id）
DROP TABLE IF EXISTS roads_vertices_raw;
CREATE TABLE roads_vertices_raw (
  node_id bigint NOT NULL,
  wkt     text   NOT NULL                -- POINT(lon lat) EPSG:4326
);

COMMIT;

-- 制表符分隔的 CSV（Python csv 模块 excel-tab dialect 写出；空字段 = NULL）
\copy roads_edges_raw    FROM '/tmp/beibu-roads-edges.tsv'    WITH (FORMAT csv, HEADER true, DELIMITER E'\t', QUOTE '"')
\copy roads_vertices_raw FROM '/tmp/beibu-roads-vertices.tsv' WITH (FORMAT csv, HEADER true, DELIMITER E'\t', QUOTE '"')

\timing off
SELECT
  (SELECT count(*) FROM roads_edges_raw)    AS raw_edges,
  (SELECT count(*) FROM roads_vertices_raw) AS raw_vertices;
