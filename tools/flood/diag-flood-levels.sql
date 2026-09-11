-- 浸没设施恒 0 + 多边形错位：一次跑满诊断（2026-09-11 v2）
--
-- 背景：代码注释 spatial.repository.ts:19-20 自证隐患——
--   「几何全部由入参经纬度现算，不读取库表几何（表为 4490），故无混合 SRID 风险。
--     若后续改为直读表几何参与运算，必须显式 ST_Transform 到同一 SRID。」
--   而 PICK_LEVEL_SQL 恰恰直读表几何（ST_AsGeoJSON(d.geom)），疑似未转换。
--
-- 跑法（服务器上一条命令跑满）：
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev -v ON_ERROR_STOP=1 < diag-flood-levels.sql

\echo '===== 【1】表规模：是否 251 档 ====='
\echo '  期望 251；若为 0 或 6 → 没灌新数据（重灌即可）'
SELECT count(*) AS total_levels, min(level) AS min_lv, max(level) AS max_lv FROM flood_levels;

\echo ''
\echo '===== 【2】关键档 feature_count（对照本地产物真值 5.0→21 8.0→17 10.0→18 15.0→18）====='
SELECT level, feature_count, flooded_km2,
       CASE WHEN geom IS NULL THEN 'NULL' ELSE ST_NumGeometries(geom)::text END AS parts
FROM flood_levels WHERE level IN (4,5,8,10,12,15) ORDER BY level;

\echo ''
\echo '===== 【3】🔴 SRID 核对（最关键！）====='
\echo '  期望 4490（CGCS2000 存储口径）。若为 0/4326 则与灌数脚本不符。'
SELECT level, ST_SRID(geom) AS srid, ST_GeometryType(geom) AS gtype
FROM flood_levels WHERE level IN (5,10) ORDER BY level;

\echo ''
\echo '===== 【4】🔴 复现后端判定：模拟「4490 几何 vs 4326 点」====='
\echo '  这段完全复刻 pointIndicesInAnyPolygon 的写法。'
\echo '  若报错 "Operation on mixed SRID geometries" → 坐实根因（后端 catch 把它吞成空数组）'
SELECT lv.level,
       count(*) FILTER (WHERE ST_Covers(
         ST_GeomFromGeoJSON(ST_AsGeoJSON(lv.geom)),                          -- 后端拿到的（SRID 丢失）
         ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326)                        -- 后端构造的点
       )) AS hit_srid_mixed
FROM flood_facilities f
CROSS JOIN (SELECT level, geom FROM flood_levels WHERE level IN (5,10)) lv
GROUP BY lv.level ORDER BY lv.level;

\echo ''
\echo '===== 【5】对照组：显式转换到 4326 后再判定（应该是正常命中数）====='
\echo '  期望 5m≈29 · 10m≈46。若这里正常而【4】为 0/报错 → 根因确认'
SELECT lv.level,
       count(*) AS facilities_total,
       count(*) FILTER (WHERE ST_Covers(
         ST_Transform(lv.geom, 4326),
         ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326)
       )) AS hit_transformed
FROM flood_facilities f
CROSS JOIN (SELECT level, geom FROM flood_levels WHERE level IN (5,8,10,15)) lv
GROUP BY lv.level ORDER BY lv.level;

\echo ''
\echo '===== 【6】设施表 SRID 与条数 ====='
SELECT count(*) AS facilities, count(DISTINCT port) AS ports FROM flood_facilities;

\echo ''
\echo '===== 判读表 ====='
\echo '【1】count=251 且【2】数字对上 → 表本身没问题，看【3】【4】'
\echo '【3】srid=4490 → 与灌数脚本一致（符合预期）'
\echo '【4】hit_srid_mixed 全 0 或报 mixed SRID 错 → 🔴 根因确认：取出未转换'
\echo '【5】hit_transformed 有值（5m≈29）→ 🔴 确证：加 ST_Transform(geom,4326) 即修复'
\echo ''
\echo '修复位置（若【4】【5】符合预期）：'
\echo '  backend/src/modules/flood/repositories/flood.repository.ts:66 和 :78'
\echo '  把 ST_AsGeoJSON(d.geom) 改为 ST_AsGeoJSON(ST_Transform(d.geom, 4326))'
