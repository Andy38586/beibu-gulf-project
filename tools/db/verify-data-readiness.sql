-- =============================================================================
-- 数据就绪自检（只读，可随时对任何库执行；含生产）
-- =============================================================================
-- 为什么要有它（2026-09-12 两次生产事故）：
--   ① 浸没分析 500 —— 生产缺 admin_boundary / admin_boundary_union（陆域裁剪依赖）；
--   ② 航线分析 26s 超时 —— roads_noded 缺路由索引（每次查询全堆扫描 765MB）。
--   两次都是「代码上线、库没跟上」，部署链路没有 DB 迁移步骤 → 只有等到用户点页面才暴露。
--
-- 本脚本把「库对象/数据不变量」变成可执行断言：任一项 FAIL 即 psql 非零退出，
-- 可人工跑，也可后续接进部署后校验（对应台账 z167「部署无 DB 迁移步骤」）。
--
-- 用法（服务器，仓库目录下）：
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev -v ON_ERROR_STOP=1 \
--     < tools/db/verify-data-readiness.sql
--   → 逐行 PASS/FAIL；有 FAIL 则退出码非零（本次检查全部通过时会打印"检查通过"）
--
-- 与 backend/test/db-readiness.spec.ts 同源（CI 侧断言版）；两者改一处须同步另一处。
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

DROP TABLE IF EXISTS pg_temp._readiness;
CREATE TEMP TABLE _readiness (
  ord    serial,
  name   text,
  ok     boolean,
  detail text
);

DO $$
DECLARE
  rec    record;
  ok     boolean;
  detail text;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- ① flood 域：淹没面陆域裁剪依赖（生产 500 事故）
      ('flood_levels 251 档（0.0–25.0）',
       $q$SELECT (count(*) = 251 AND min(level) = 0 AND max(level) = 25),
                 format('count=%s min=%s max=%s', count(*), min(level), max(level))
          FROM flood_levels$q$),
      ('admin_boundary 12 区县 / SRID 4326 / 几何有效',
       $q$SELECT (count(*) = 12 AND min(ST_SRID(geom)) = 4326
                  AND count(*) FILTER (WHERE NOT ST_IsValid(geom)) = 0),
                 format('rows=%s srid=%s invalid=%s', count(*), min(ST_SRID(geom)),
                        count(*) FILTER (WHERE NOT ST_IsValid(geom)))
          FROM admin_boundary$q$),
      ('admin_boundary_union 单行 / SRID 4326 / 面积≈20982.70 km²（±0.5%）',
       $q$SELECT (count(*) = 1 AND min(ST_SRID(geom)) = 4326
                  AND abs(max(ST_Area(geom::geography)) / 1e6 - 20982.70) / 20982.70 < 0.005),
                 format('rows=%s srid=%s area=%s km²', count(*), min(ST_SRID(geom)),
                        round(max(ST_Area(geom::geography)) / 1e6)::numeric, 0)
          FROM admin_boundary_union$q$),
      ('flood_facilities 设施数 > 0（disaster 评估依赖）',
       $q$SELECT count(*) > 0, format('rows=%s', count(*)) FROM flood_facilities$q$),

      -- ② route 域：构图性能前提（生产 26s 事故）
      ('pgrouting 扩展已安装',
       $q$SELECT count(*) = 1, format('rows=%s', count(*))
          FROM pg_extension WHERE extname = 'pgrouting'$q$),
      ('roads_noded 可通行主分量边 > 0',
       $q$SELECT count(*) > 0, format('routable=%s', count(*))
          FROM roads_noded WHERE cost_m > 0 AND main_comp IS TRUE$q$),
      ('roads_noded id 点查索引存在（首键列 = id）',
       $q$SELECT count(*) > 0, format('indexes=%s', count(*))
          FROM pg_index i
          JOIN pg_class t ON t.oid = i.indrelid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
         WHERE t.relname = 'roads_noded' AND a.attname = 'id'$q$),
      ('roads_noded 路由覆盖索引存在（谓词与 edges_sql 一致）',
       $q$SELECT count(*) > 0, format('indexes=%s', count(*))
          FROM pg_index i
          JOIN pg_class t ON t.oid = i.indrelid
         WHERE t.relname = 'roads_noded'
           AND pg_get_indexdef(i.indexrelid) ILIKE '%INCLUDE (source, target, cost_m, cost_min)%'
           AND pg_get_indexdef(i.indexrelid) ILIKE '%main_comp IS TRUE%'$q$)
      -- ⚠️ 勿加 `cost_m > 0` 字面断言：pg_get_indexdef 会规范化为 cost_m > (0)::double
      -- precision，字面匹配恒落空（2026-09-12 真库实测踩过，故只用 INCLUDE+main_comp 两段）
    ) AS t(name, sql)
  LOOP
    BEGIN
      EXECUTE 'SELECT ok, detail FROM (' || rec.sql || ') s(ok, detail)' INTO ok, detail;
      INSERT INTO _readiness (name, ok, detail) VALUES (rec.name, COALESCE(ok, false), detail);
    EXCEPTION WHEN OTHERS THEN
      -- 表/扩展缺失等直接落 FAIL 行（错误原文可定位），不让脚本本身报错中断
      INSERT INTO _readiness (name, ok, detail) VALUES (rec.name, false, '检查失败: ' || SQLERRM);
    END;
  END LOOP;
END $$;

-- ③ 性能探针（informational）：同一坐标对跑一次构图+寻路，暴露「索引失效 → 全堆扫描」
DO $$
DECLARE
  t0     timestamptz := clock_timestamp();
  n      bigint;
  ms     numeric;
BEGIN
  SELECT count(*) INTO n
  FROM pgr_withPoints(
    $q$SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost
         FROM roads_noded WHERE cost_m > 0 AND main_comp IS TRUE
         AND source IS NOT NULL AND target IS NOT NULL$q$,
    $q$WITH s(pid, lng, lat) AS (
         VALUES (1, 108.63::float8, 21.95::float8), (2, 108.65::float8, 21.93::float8)
       )
       SELECT p.pid::int AS pid, r.id::bigint AS edge_id,
              ST_LineLocatePoint(r.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490))::float8 AS fraction,
              'b'::char AS side
         FROM s p CROSS JOIN LATERAL (
           SELECT id, geom FROM roads_noded
            WHERE cost_m > 0 AND main_comp IS TRUE AND geom IS NOT NULL
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4490) LIMIT 1
         ) r$q$,
    1, 2, directed := false);
  ms := round(EXTRACT(epoch FROM clock_timestamp() - t0) * 1000);
  INSERT INTO _readiness (name, ok, detail)
  VALUES ('性能探针：一次构图+寻路 < 10s（目标 < 5s）', ms < 10000,
          format('%s ms（rows=%s）', ms, n));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _readiness (name, ok, detail)
  VALUES ('性能探针：一次构图+寻路 < 10s（目标 < 5s）', false, '探针失败: ' || SQLERRM);
END $$;

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name, detail
FROM _readiness ORDER BY ord;

SELECT count(*) FILTER (WHERE NOT ok) AS failed_checks, count(*) AS total_checks FROM _readiness;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _readiness WHERE NOT ok) THEN
    RAISE EXCEPTION '数据就绪检查未通过（见上方 FAIL 行；迁移脚本见 tools/db/ 与 tools/roads/）';
  END IF;
END $$;

\echo '===== 数据就绪检查全部通过 ====='
