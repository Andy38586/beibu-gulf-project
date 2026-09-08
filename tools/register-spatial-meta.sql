-- 坐标系元数据登记（2026-09-08）：8 张空间表的存储/源坐标系与转换路径
-- 与 tools/db-schema.sql 的 spatial_meta 表定义配套，重放幂等（ON CONFLICT DO UPDATE）
CREATE TABLE IF NOT EXISTS spatial_meta (
  table_name  TEXT PRIMARY KEY,
  storage_crs TEXT NOT NULL,
  source_crs  TEXT NOT NULL,
  transform   TEXT,
  notes       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO spatial_meta (table_name, storage_crs, source_crs, transform, notes) VALUES
  ('ports', 'EPSG:4490', 'EPSG:4326', '高德GCJ-02→WGS84（采集已转换）→4490直接赋值', '3 港（北海/钦州/防城），源 frontend/public/data/ports.json'),
  ('poi_facilities', 'EPSG:4490', 'EPSG:4326', '高德GCJ-02→WGS84（采集已转换）→4490直接赋值', '三城 2846 条（含 port_pier），源高德 POI 重抓'),
  ('xiaoqu', 'EPSG:4490', 'EPSG:4326', '高德GCJ-02→WGS84（采集已转换）→4490直接赋值', '三城 2456 条小区'),
  ('flood_facilities', 'EPSG:4490', 'EPSG:4326', '高德GCJ-02→WGS84（采集已转换）→4490直接赋值', '83 个受淹评估设施（elevation/value 为估算，见源文件 _provenance）'),
  ('roads', 'EPSG:4490', 'EPSG:4326', 'ogr2ogr -t_srs EPSG:4490（源 OSM WGS84）', 'OSM 派生 165111 条线，length_m 按 geography 回填'),
  ('railways', 'EPSG:4490', 'EPSG:4326', 'ogr2ogr -t_srs EPSG:4490', 'OSM 派生 9481 条线'),
  ('mangroves', 'EPSG:4490', 'EPSG:4326', 'ogr2ogr -spat 裁剪 + -t_srs EPSG:4490', 'GMW v3 全球 11 时相，广西 bbox 裁剪后入库'),
  ('industrial_zones', 'EPSG:4490', 'EPSG:4326', 'ogr2ogr -nlt PROMOTE_TO_MULTI + -t_srs EPSG:4490', 'OSM 派生 2687 个工业园区面'),
  ('canal', 'EPSG:4490', 'EPSG:4326', 'ogr2ogr -t_srs EPSG:4490', '平陆运河示意线（手工描绘，示意精度）'),
  ('protected_areas', 'EPSG:4490', 'EPSG:4326', 'ogr2ogr -nlt PROMOTE_TO_MULTI + -t_srs EPSG:4490', 'WDPA 中国保护区 34 个面')
ON CONFLICT (table_name) DO UPDATE SET
  storage_crs = EXCLUDED.storage_crs,
  source_crs  = EXCLUDED.source_crs,
  transform   = EXCLUDED.transform,
  notes       = EXCLUDED.notes,
  updated_at  = now();