-- 淹没档位表 —— algorithm-service 能力下沉 PostGIS（2026-09-10）
-- 设计依据：docs/算法服务下沉PostGIS-设计-2026-09-10.md（v3）
-- 灌数：node tools/flood/flood-levels-to-pg.mjs  →  docker exec beibu-postgis psql -f
--       （复用 tools/db/db-import.mjs 的「生成 SQL + psql 执行」模式，不引入 pg 依赖）
-- 幂等：脚本内 TRUNCATE 后重灌，与本文件 IF NOT EXISTS 配合可反复执行
--
-- 背景：生产淹没分析此前走 NestJS 读 floodArea.json（**仅 6 档**：0/2/5/8/10/15），
-- 而 251 档精细数据（flood_levels.json.gz，0.1m 步长）只存在于 FastAPI 且属死代码路径
-- （floodAdapter 的 dataSource 硬编码 'fetch'，setDataSource 全仓零调用）。
-- 本表把 251 档落到 PostGIS，成为唯一数据源，消除精度退化。
--
-- ⚠️ 本文件**只建 flood_levels 一张表**。
--    flood_facilities（83 个设施）**早已存在**：tools/db/db-schema.sql:61 定义、
--    tools/db/db-import.mjs:219 灌数、tools/db/register-spatial-meta.sql:16 登记。
--    **不要在此重复定义，更不要在灌数脚本里 TRUNCATE 它**（会清掉现有 83 行）。

-- ============================================================================
-- flood_levels —— 251 档淹没范围（唯一数据源）
-- ============================================================================
-- 刻意不存的两个字段（各有依据，勿"顺手加回"）：
--   · riskLevel：flood.constants.ts:6 注释自述「预计算档位表无 riskLevel 字段，由水位
--     分段派生」，且 deriveRiskLevel() 已存在 → 由 NestJS 复用现有函数派生，
--     避免引入第二份阈值表（双份真相）。
--   · features_json：properties.area 唯一用途是排序（flood_engine.py:222 按 area 降序），
--     前端零消费 → 由 ST_Area(geom) 复现，无需冗余 JSONB。
CREATE TABLE IF NOT EXISTS flood_levels (
  level         NUMERIC(3,1)   PRIMARY KEY,
  feature_count INTEGER        NOT NULL,
  flooded_km2   NUMERIC(12,4)  NOT NULL,
  geom          GEOMETRY(MultiPolygon, 4490),
  generated_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);

COMMENT ON TABLE  flood_levels IS '251 档连通性淹没范围（0.0~25.0m，0.1 步长）；由 flood_levels.json.gz 灌入';

COMMENT ON COLUMN flood_levels.level         IS '水位（米，EGM96 口径——与 DEM 及 flood_levels.json.gz 键一致）';
COMMENT ON COLUMN flood_levels.feature_count IS '该档多边形数量；灌数后校验须等于 ST_NumGeometries(geom)';
COMMENT ON COLUMN flood_levels.flooded_km2   IS '淹没面积 km²，原值透传（口径与现网一致，不由 geom 反算）';
COMMENT ON COLUMN flood_levels.geom          IS '全部多边形聚合。必须由手工拼 MULTIPOLYGON 生成（等价 ST_Collect），禁用 ST_Union——Union 会融合相交多边形，导致 ST_Dump 拆出的集合与原 features 数组不一致';

CREATE INDEX IF NOT EXISTS idx_flood_levels_geom ON flood_levels USING GIST (geom);

-- 读取语义（唯一允许的取档方式，三处必须同向＝向上取档）：
--   SELECT ... FROM flood_levels WHERE level >= $1 ORDER BY level LIMIT 1
-- 对齐 NestJS pickZone（waterLevel >= level）与 FastAPI _level_key（ceil）。

-- ============================================================================
-- 后续待办（不阻塞本文件执行）
-- ============================================================================
-- spatial_meta 登记：新表须在 tools/db/register-spatial-meta.sql 补一条，
--   格式参照其中 flood_facilities 那一行（表名 / 存储 SRID / 输出 SRID / 坐标系来源 / 说明）。
-- 灌数后自检（脚本末尾已含 DO $$ 断言，此处为手工复核用）：
--   SELECT count(*), min(level), max(level) FROM flood_levels;               -- 期望 251, 0.0, 25.0
--   SELECT level, feature_count, ST_NumGeometries(geom) AS actual
--     FROM flood_levels WHERE geom IS NOT NULL AND feature_count <> ST_NumGeometries(geom);
--     → 应返回 0 行（否则几何被融合了）
--   SELECT level FROM flood_levels WHERE level >= 3.47 ORDER BY level LIMIT 1;  -- 期望 3.5
--   SELECT level FROM flood_levels WHERE level >= 30   ORDER BY level LIMIT 1;  -- 期望 25.0
