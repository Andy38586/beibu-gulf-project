-- 坐标系元数据登记（2026-09-08）：10 张空间表的存储/源坐标系与转换路径
-- 与 tools/db/db-schema.sql 的 spatial_meta 表定义配套，重放幂等（ON CONFLICT DO UPDATE）
--
-- ⚠️ transform 列口径修正（2026-09-11）：原四行 POI 类表写「高德GCJ-02→WGS84（采集已转换）」，
-- 但抓取/导入脚本（tools/poi/fetch-amap-poi.mjs、tools/gis-import/import-port-poi.mjs）
-- 实测**没有任何 GCJ 转换代码，原样落盘后 4490 直接赋值**；2026-09-11 坐标系审计以
-- 「与权威 ports.json 逐位一致 + 落路率平移实验 + GCJ 偏移量级排除」三链实测确认
-- 现网数据基准为 WGS84。故 transform 改为实测口径如实记录——避免「已转换」的错误安全感，
-- 也避免后人据此推断存在一段不存在的转换逻辑。若更换高德 key 重抓，须先验证返回基准
--（见 notes 与 tools/v3-guard/anchor-check.mjs 的锚点守卫）。
CREATE TABLE IF NOT EXISTS spatial_meta (
  table_name  TEXT PRIMARY KEY,
  storage_crs TEXT NOT NULL,
  source_crs  TEXT NOT NULL,
  transform   TEXT,
  notes       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO spatial_meta (table_name, storage_crs, source_crs, transform, notes) VALUES
  ('ports', 'EPSG:4490', 'EPSG:4326', '源 ports.json 基准为 WGS84（项目权威坐标）→ 4490 直接赋值', '3 港（北海/钦州/防城），源 frontend/public/data/ports.json；2026-09-11 复核与库内一致'),
  ('poi_facilities', 'EPSG:4490', 'EPSG:4326', '高德 POI 源坐标基准实测为 WGS84（2026-09-11 三链验证：与权威港口坐标逐位一致、落路率平移实验、GCJ 偏移量级排除；抓取脚本无转换代码、原样落盘）→ 4490 直接赋值', '三城 2846 条（含 port_pier）；⚠️ 更换 key 重抓前须先验证返回基准（脚本原样落盘，无 GCJ 转换）'),
  ('xiaoqu', 'EPSG:4490', 'EPSG:4326', '高德 POI 源坐标基准实测为 WGS84（2026-09-11 三链验证，同 poi_facilities）→ 4490 直接赋值', '三城 2456 条小区；⚠️ 更换 key 重抓前须先验证返回基准'),
  ('flood_facilities', 'EPSG:4490', 'EPSG:4326', '高德 POI 源坐标基准实测为 WGS84（2026-09-11 三链验证，同 poi_facilities）→ 4490 直接赋值', '83 个受淹评估设施（elevation/value 为估算，见源文件 _provenance）；⚠️ 更换 key 重抓前须先验证返回基准'),
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