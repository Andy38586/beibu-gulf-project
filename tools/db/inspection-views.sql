-- =============================================================================
-- 数据巡检视图（只读，纯便利设施；供 DBeaver / psql 可视化与对账用）
-- =============================================================================
-- 为什么需要：
--   ① 库里空间表统一存 EPSG:4490，而 DBeaver 的底图是 4326/3857——直接看会错位；
--      本脚本给每类几何建一份 **4326 视图**（ST_Transform），DBeaver 里直接打开即可叠底图。
--   ② 拓扑质量肉眼可查：`v_road_node_degree_4326` 按节点度数（1=断头 / 2=过路 / ≥3=路口）
--      出点，DBeaver 里按 degree 着色，一眼能看出"该连没连 / 不该连连了"。
--
-- 口径：**不改动任何业务表**；源表不存在则跳过该视图（环境无关，本地库缺 roads_noded 也能跑）；
-- 幂等可重复执行（CREATE OR REPLACE）。
-- 用法：
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev -v ON_ERROR_STOP=1 \
--     < tools/db/inspection-views.sql
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      -- ① 原始路网（未切分）
      ('v_roads_4326', 'roads',
       $q$SELECT id, osm_id, name, class, highway, length_m,
                 ST_Transform(geom, 4326) AS geom
          FROM roads$q$),

      -- ② 路由表（切分 + 拓扑 + 权重后的 roads_noded）
      ('v_roads_noded_4326', 'roads_noded',
       $q$SELECT id, old_id, class, highway, name, length_m,
                 source, target, cost_m, cost_min, main_comp,
                 ST_Transform(geom, 4326) AS geom
          FROM roads_noded$q$),

      -- ③ 拓扑节点 + 度数：1=断头端点｜2=过路点（本不该成为节点）｜≥3=真实路口
      ('v_road_node_degree_4326', 'roads_noded',
       $q$WITH ends AS (
            SELECT source AS node, ST_Transform(ST_StartPoint(geom), 4326) AS geom
            FROM roads_noded WHERE source IS NOT NULL
            UNION ALL
            SELECT target, ST_Transform(ST_EndPoint(geom), 4326)
            FROM roads_noded WHERE target IS NOT NULL
          )
          SELECT node, count(*) AS degree,
                 ST_Centroid(ST_Collect(geom))::geometry(Point, 4326) AS geom
          FROM ends GROUP BY node$q$),

      -- ④ 淹没档位（251 档）
      ('v_flood_levels_4326', 'flood_levels',
       $q$SELECT level, feature_count, flooded_km2, ST_Transform(geom, 4326) AS geom
          FROM flood_levels$q$),

      -- ⑤ 淹没设施点 / 港口 / 小区 / POI
      ('v_flood_facilities_4326', 'flood_facilities',
       $q$SELECT id, name, type, port, elevation, value, damage_rate, risk_level,
                 ST_Transform(geom, 4326) AS geom
          FROM flood_facilities$q$),
      ('v_ports_4326', 'ports',
       $q$SELECT id, name, type, address, ST_Transform(geom, 4326) AS geom FROM ports$q$),
      ('v_xiaoqu_4326', 'xiaoqu',
       $q$SELECT id, name, city, district, ST_Transform(geom, 4326) AS geom FROM xiaoqu$q$),
      ('v_poi_facilities_4326', 'poi_facilities',
       $q$SELECT id, name, type, city, district, ST_Transform(geom, 4326) AS geom
          FROM poi_facilities$q$),

      -- ⑥ 行政区划并集（淹没面陆域裁剪的边界）
      ('v_admin_boundary_union_4326', 'admin_boundary_union',
       $q$SELECT id, ST_Transform(geom, 4326) AS geom FROM admin_boundary_union$q$),

      -- ⑦ 原始各级面（选址/裁剪对照）
      ('v_admin_boundary_4326', 'admin_boundary',
       $q$SELECT adcode, name, ST_Transform(geom, 4326) AS geom FROM admin_boundary$q$)
    ) AS t(view_name, src_table, body)
  LOOP
    IF to_regclass('public.' || v.src_table) IS NULL THEN
      RAISE NOTICE '跳过 %（源表 % 不存在）', v.view_name, v.src_table;
      CONTINUE;
    END IF;
    EXECUTE format('CREATE OR REPLACE VIEW %I AS %s', v.view_name, v.body);
    RAISE NOTICE '已建视图 %（源表 %）', v.view_name, v.src_table;
  END LOOP;
END $$;

-- 巡检汇总：逐表计数（动态 SQL，表不存在则标注，不用一次 UNION 全部表 → 缺表也不报错）
\echo '===== 数据规模汇总 ====='
DO $$
DECLARE
  t     text;
  n     bigint;
  names text[] := ARRAY[
    'roads', 'roads_noded', 'flood_levels', 'flood_facilities',
    'ports', 'poi_facilities', 'xiaoqu', 'admin_boundary'
  ];
BEGIN
  FOREACH t IN ARRAY names LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '  % = （表不存在）', t;
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    RAISE NOTICE '  % = % 行', t, n;
  END LOOP;
END $$;

\echo '===== 完成：v_*_4326 系列视图可直接在 DBeaver 里叠加底图查看 ====='
