-- ============================================================================
-- roads-graph-build.sql — v2 路网建图：raw 装载表 → 有向图（pgRouting 可直接吃）
--
-- 与旧管线（roadc 端到端 26s 那次）的差别，逐条都能追溯到 2026-09-12 复盘：
--   ① 拓扑：顶点 = OSM node id。旧管线的顶点是「投影切分 + 60m 网格并点」造出来的
--      代理点，上跨/下穿共用一个近似点 → 在立交处凭空生成路口（"下穿国道直接拐上高架"）。
--   ② 单行：cost / reverse_cost 分开给，oneway=1 → reverse_cost=-1，oneway=-1 → cost=-1。
--      旧表根本没有 reverse_cost 列，pgr 以 directed:=false 跑 → 高速双向可逆行的根因。
--   ③ 等级：route_class_profile 给缺省限速 + 可通行判定 + 偏好惩罚（惩罚只进选路代价，
--      不污染对外报告的时长——报告值仍由真实 cost_min 汇总）。
--   ④ 报告与选路解耦：cost_min 是"物理时间"，route_cost_min 是"选路偏好时间"。
--
-- 幂等：可反复执行（每次 DROP + 重建）。不含 \copy，装载见 roads-graph-import.sql。
-- 用法：psql -v ON_ERROR_STOP=1 -f roads-graph-build.sql
-- ============================================================================
\set ON_ERROR_STOP on
\timing on
SET client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- 【1】等级参数表：缺省限速 / 是否可通行 / 偏好惩罚
--   惩罚只乘进 route_cost_*（pgr 选路用），不进 cost_min（对外报告用）：
--   否则"最快路线"会报出一个被人为放大的时长，用户一眼能看出不对。
-- ---------------------------------------------------------------------------
BEGIN;

DROP TABLE IF EXISTS route_class_profile;
CREATE TABLE route_class_profile (
  highway      text PRIMARY KEY,
  speed_kph    numeric(5,1) NOT NULL,
  drivable     boolean      NOT NULL,
  pref_penalty numeric(4,2) NOT NULL,
  note         text         NOT NULL DEFAULT ''
);

INSERT INTO route_class_profile (highway, speed_kph, drivable, pref_penalty, note) VALUES
  ('motorway',          110, true,  1.00, '高速公路'),
  ('motorway_link',      60, true,  1.00, '高速匝道'),
  ('trunk',              80, true,  1.00, '国道/城市快速路'),
  ('trunk_link',         50, true,  1.03, ''),
  ('primary',            60, true,  1.00, '主干道'),
  ('primary_link',       40, true,  1.03, ''),
  ('secondary',          50, true,  1.02, '次干道'),
  ('secondary_link',     40, true,  1.05, ''),
  ('tertiary',           40, true,  1.05, '支路'),
  ('tertiary_link',      30, true,  1.05, ''),
  ('unclassified',       30, true,  1.12, '等级未明（多为镇道/村道）'),
  ('residential',        25, true,  1.25, '居住区道路：避免穿小区抄近路'),
  ('living_street',      15, true,  1.45, '生活街区：行人优先'),
  ('service',            20, true,  1.35, '服务道（含港区/码头/停车场通道）'),
  ('services',           20, true,  1.35, '高速服务区'),
  ('road',               30, true,  1.20, '等级未标注'),
  ('busway',             20, true,  1.60, '公交专用道'),
  ('rest_area',          15, true,  1.60, '休息区'),
  ('raceway',            20, false, 1.00, '赛道'),
  ('construction',       20, false, 1.00, '在建：不可通行'),
  ('proposed',           20, false, 1.00, '规划：不可通行'),
  ('pedestrian',          5, false, 1.00, '步行街：不可通行'),
  ('corridor',            5, false, 1.00, '室内通道'),
  ('elevator',            5, false, 1.00, '电梯'),
  ('escalator',           5, false, 1.00, '扶梯'),
  ('platform',            5, false, 1.00, '站台'),
  ('steps',               5, false, 1.00, '台阶'),
  ('footway',             5, false, 1.00, '人行道'),
  ('path',                5, false, 1.00, '小径'),
  ('cycleway',            5, false, 1.00, '自行车道'),
  ('track',               5, false, 1.00, '机耕道：抽取阶段已排除'),
  ('bridleway',           5, false, 1.00, '马道：抽取阶段已排除'),
  -- 以下 6 个由【6】自检在生产建图时首次暴露（2026-09-13）：本地/生产同一份 TSV 都含这些
  -- 取值，此前因未登记而被笼统当成不可通行——登记成不可通行后代价语义完全一致（cost=-1），
  -- 但自检才能成立：否则任何新出现的未登记等级都会让建图脚本在最后一步失败。
  ('bus_stop',            5, false, 1.00, '公交站台（非道路）'),
  ('disused',             5, false, 1.00, '废弃路段'),
  ('escape',             30, false, 1.00, '避险/逃逸车道（非正常通行）'),
  ('ladder',              5, false, 1.00, '梯道'),
  ('no',                  5, false, 1.00, '显式标注不是道路'),
  ('passing_place',      20, false, 1.00, '错车道（随主路，不做独立可通行边）');

COMMIT;

-- ---------------------------------------------------------------------------
-- 【2】图顶点：OSM node id → 库内顶点 id（bigint 直通 pgRouting）
-- ---------------------------------------------------------------------------
BEGIN;

DROP TABLE IF EXISTS roads_vertices CASCADE;
CREATE TABLE roads_vertices (
  node_id bigint PRIMARY KEY,                  -- = OSM node id（全球唯一定位）
  geom    geometry(Point, 4490) NOT NULL
);

INSERT INTO roads_vertices (node_id, geom)
SELECT node_id, ST_Transform(ST_SetSRID(ST_GeomFromText(wkt), 4326), 4490)
  FROM roads_vertices_raw;

COMMIT;

-- ---------------------------------------------------------------------------
-- 【3】图边：有向代价
--   cost_m / reverse_cost_m    —— 距离口径（-1 = 该方向不可通行，pgRouting 约定）
--   cost_min / reverse_cost_min —— 时间口径（分钟，物理时间，对外报告用）
--   route_cost_min / route_reverse_cost_min —— 乘过等级偏好，仅 pgr 选路用
-- ---------------------------------------------------------------------------
BEGIN;

DROP TABLE IF EXISTS roads_edges CASCADE;
CREATE TABLE roads_edges (
  id                    bigint PRIMARY KEY,     -- 稳定段号（装载序）
  way_id                bigint NOT NULL,        -- OSM way id（溯源）
  seg                   int    NOT NULL,
  source                bigint NOT NULL,        -- → roads_vertices.node_id
  target                bigint NOT NULL,
  class                 text   NOT NULL,        -- 沿用既有字段名（值 = OSM highway）
  name                  text,
  ref                   text,
  oneway                smallint NOT NULL,
  bridge                boolean NOT NULL DEFAULT false,
  tunnel                boolean NOT NULL DEFAULT false,
  layer                 int     NOT NULL DEFAULT 0,
  maxspeed_kph          int,                    -- OSM 真值（可能 NULL）
  speed_kph             numeric(5,1) NOT NULL,  -- 生效速度
  access                text,
  junction              text,
  length_m              numeric(10,2) NOT NULL,
  cost_m                numeric(10,2) NOT NULL,
  reverse_cost_m        numeric(10,2) NOT NULL,
  cost_min              numeric(10,4) NOT NULL,
  reverse_cost_min      numeric(10,4) NOT NULL,
  route_cost_min        numeric(10,4) NOT NULL,
  route_reverse_cost_min numeric(10,4) NOT NULL,
  main_comp             boolean NOT NULL DEFAULT false,
  geom                  geometry(LineString, 4490) NOT NULL
);

WITH prepared AS (
  SELECT
    r.*,
    ST_Transform(ST_SetSRID(ST_GeomFromText(r.wkt), 4326), 4490) AS g,
    p.drivable,
    p.speed_kph   AS class_speed,
    p.pref_penalty AS class_penalty,
    (p.highway IS NOT NULL) AS class_mapped
  FROM roads_edges_raw r
  LEFT JOIN route_class_profile p ON p.highway = r.highway
),
calc AS (
  SELECT
    prepared.*,
    -- ::numeric 必须显式转：ST_Length(geography) 返回 double precision，
    -- 而 round(double precision, int) 不存在（只有 round(numeric, int)）
    ST_Length(g::geography)::numeric AS len_m,
    -- 生效速度：maxspeed 真值（夹到 5..130 km/h）优先，否则等级缺省
    LEAST(GREATEST(COALESCE(maxspeed, class_speed), 5), 130)::numeric(5,1) AS speed_eff,
    -- 限制性通行（港口作业区/小区内部路）：可走但惩罚，避免把码头/园区通道从图里删掉
    CASE WHEN COALESCE(access, '') IN ('private', 'customers', 'delivery', 'destination', 'agricultural', 'forestry')
         THEN 2.0 ELSE 1.0 END AS access_penalty,
    (COALESCE(drivable, false)
     AND COALESCE(access, '') <> 'no'
     AND COALESCE(motor_vehicle, '') <> 'no'
     AND COALESCE(vehicle, '') <> 'no'
     AND ST_Length(g::geography) > 0.5) AS usable
  FROM prepared
)
INSERT INTO roads_edges (
  id, way_id, seg, source, target, class, name, ref, oneway, bridge, tunnel, layer,
  maxspeed_kph, speed_kph, access, junction, length_m,
  cost_m, reverse_cost_m, cost_min, reverse_cost_min,
  route_cost_min, route_reverse_cost_min, geom
)
SELECT
  row_number() OVER ()::bigint,
  osm_way_id, seg, from_node, to_node, highway, name, ref, oneway,
  bridge <> 0, tunnel <> 0, layer,
  maxspeed, speed_eff, access, junction, round(len_m, 2),
  -- 距离口径：oneway=-1 → cost=-1；oneway=1 → reverse_cost=-1；双向 → 两侧同为长度
  CASE WHEN NOT usable THEN -1
       WHEN oneway = -1 THEN -1
       ELSE round(len_m, 2) END,
  CASE WHEN NOT usable THEN -1
       WHEN oneway = 1 THEN -1
       ELSE round(len_m, 2) END,
  -- 时间口径（分钟）= 米 / (km/h × 1000 / 60)
  CASE WHEN NOT usable THEN -1
       WHEN oneway = -1 THEN -1
       ELSE round(len_m / (speed_eff * 1000 / 60), 4) END,
  CASE WHEN NOT usable THEN -1
       WHEN oneway = 1 THEN -1
       ELSE round(len_m / (speed_eff * 1000 / 60), 4) END,
  -- 选路口径：物理时间 × 等级偏好 × 通行限制惩罚（-1 保持 -1）
  CASE WHEN NOT usable THEN -1
       WHEN oneway = -1 THEN -1
       ELSE round(len_m / (speed_eff * 1000 / 60) * class_penalty * access_penalty, 4) END,
  CASE WHEN NOT usable THEN -1
       WHEN oneway = 1 THEN -1
       ELSE round(len_m / (speed_eff * 1000 / 60) * class_penalty * access_penalty, 4) END,
  g
FROM calc;

COMMIT;

-- ---------------------------------------------------------------------------
-- 【4】主分量：无向连通意义下的最大分量（按边数）
--   为什么要它：抽取的 bbox 会切出海岛/飞地小分量；把它们标出来，路由时限定在
--   主分量内可避免"起点落在孤岛上 → 整图搜索后返回不可达"的浪费。
--   注：pgr_connectedComponents 忽略代价、按无向连通计算。
-- ---------------------------------------------------------------------------
BEGIN;

UPDATE roads_edges SET main_comp = false;

CREATE TEMP TABLE tmp_main_comp AS
WITH comp AS (
  SELECT * FROM pgr_connectedComponents(
    'SELECT row_number() OVER ()::bigint AS id, source, target, 1 AS cost, 1 AS reverse_cost
       FROM roads_edges WHERE cost_m > 0 OR reverse_cost_m > 0'
  )
),
ranked AS (
  SELECT c.component, count(*) AS edge_cnt
    FROM roads_edges e
    JOIN comp c ON c.node = e.source
   WHERE (e.cost_m > 0 OR e.reverse_cost_m > 0)
   GROUP BY c.component
   ORDER BY edge_cnt DESC
   LIMIT 1
)
SELECT c.node
  FROM comp c
  JOIN ranked r ON r.component = c.component;

UPDATE roads_edges e
   SET main_comp = true
 WHERE (e.cost_m > 0 OR e.reverse_cost_m > 0)
   AND e.source IN (SELECT node FROM tmp_main_comp)
   AND e.target IN (SELECT node FROM tmp_main_comp);

DROP TABLE tmp_main_comp;

COMMIT;

-- ---------------------------------------------------------------------------
-- 【5】索引
--   · idx_roads_edges_routing —— 覆盖索引：谓词与 route 仓库的 edges_sql 逐字一致，
--     让 pgr 每次查询构图走 index-only scan（2026-09-12 生产 26s 事故的教训：
--     无覆盖索引时每次查询全堆扫描 ~765MB）。
-- ---------------------------------------------------------------------------
BEGIN;

CREATE INDEX idx_roads_vertices_geom ON roads_vertices USING GIST (geom);

-- 吸附用：只索引可通行的边（与 route 仓库的 snapping 谓词一致）
CREATE INDEX idx_roads_edges_geom_usable ON roads_edges USING GIST (geom)
  WHERE (cost_m > 0 OR reverse_cost_m > 0);

CREATE INDEX idx_roads_edges_source ON roads_edges (source);
CREATE INDEX idx_roads_edges_target ON roads_edges (target);

CREATE INDEX idx_roads_edges_routing ON roads_edges (id)
  INCLUDE (source, target, cost_m, reverse_cost_m, cost_min, reverse_cost_min)
  WHERE main_comp IS TRUE;

CREATE INDEX idx_roads_edges_main_comp ON roads_edges (main_comp) WHERE main_comp IS TRUE;

COMMIT;

ANALYZE roads_edges;
ANALYZE roads_vertices;

-- visibility map：覆盖索引要被 index-only scan 采用，必须 VACUUM（且不能进事务块；
-- 并行 VACUUM 会撞 docker 默认 64MB /dev/shm，先关并行）
SET max_parallel_maintenance_workers = 0;
VACUUM (ANALYZE) roads_edges;

-- ---------------------------------------------------------------------------
-- 【6】自检：任何一条不成立都必须让脚本失败（否则问题会漂到生产）
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n bigint;
  txt text;
BEGIN
  -- 顶点完整性：边的两端必须都是已登记顶点，否则 pgr 构图会静默丢弃该边
  SELECT count(*) INTO n
    FROM roads_edges e
   WHERE NOT EXISTS (SELECT 1 FROM roads_vertices v WHERE v.node_id = e.source)
      OR NOT EXISTS (SELECT 1 FROM roads_vertices v WHERE v.node_id = e.target);
  IF n > 0 THEN
    RAISE EXCEPTION '自检失败：% 条边的端点不在 roads_vertices 中', n;
  END IF;

  -- 零长边：会污染最短路代价
  SELECT count(*) INTO n FROM roads_edges WHERE length_m <= 0;
  IF n > 0 THEN
    RAISE EXCEPTION '自检失败：% 条零长边', n;
  END IF;

  -- 等级全部有参数：未映射的等级会被当成不可通行，必须显式暴露
  SELECT string_agg(DISTINCT e.class, ', ') INTO txt
    FROM roads_edges e
    LEFT JOIN route_class_profile p ON p.highway = e.class
   WHERE p.highway IS NULL;
  IF txt IS NOT NULL THEN
    RAISE EXCEPTION '自检失败：以下等级未在 route_class_profile 中定义 -> %', txt;
  END IF;

  -- 单行必须真的生效：oneway=1 → reverse_cost_m = -1；oneway=-1 → cost_m = -1
  SELECT count(*) INTO n FROM roads_edges
   WHERE (oneway = 1 AND reverse_cost_m <> -1) OR (oneway = -1 AND cost_m <> -1);
  IF n > 0 THEN
    RAISE EXCEPTION '自检失败：% 条单行边的反向代价未置 -1（单行未生效）', n;
  END IF;

  -- 单行样本必须非空：整表 0 条单行 = oneway 属性又丢了（旧管线的形态）
  SELECT count(*) INTO n FROM roads_edges WHERE oneway <> 0 AND cost_m > 0;
  IF n = 0 THEN
    RAISE EXCEPTION '自检失败：无任何单向边——oneway 属性疑似丢失（旧管线的经典形态）';
  END IF;

  -- 桥隧样本必须非空
  SELECT count(*) INTO n FROM roads_edges WHERE bridge OR tunnel;
  IF n = 0 THEN
    RAISE EXCEPTION '自检失败：无任何桥/隧边——bridge/tunnel 属性疑似丢失';
  END IF;

  -- 主分量覆盖：可通行边里应有过半落在主分量
  SELECT count(*) FILTER (WHERE main_comp) * 100.0 / NULLIF(count(*), 0) INTO n
    FROM roads_edges WHERE cost_m > 0 OR reverse_cost_m > 0;
  IF n < 50 THEN
    RAISE EXCEPTION '自检失败：主分量仅覆盖可通行边的 %%%（< 50%%）', n::numeric(5,1);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 【7】摘要
-- ---------------------------------------------------------------------------
SELECT
  count(*)                                                                     AS edges,
  count(*) FILTER (WHERE cost_m > 0 OR reverse_cost_m > 0)                     AS usable_edges,
  count(*) FILTER (WHERE oneway <> 0)                                          AS oneway_edges,
  count(*) FILTER (WHERE bridge OR tunnel)                                     AS bridge_tunnel_edges,
  count(*) FILTER (WHERE maxspeed_kph IS NOT NULL)                             AS maxspeed_edges,
  count(*) FILTER (WHERE main_comp)                                            AS main_comp_edges,
  round(sum(length_m) FILTER (WHERE cost_m > 0 OR reverse_cost_m > 0) / 1000)  AS usable_km,
  round(min(length_m)::numeric, 2)                                             AS min_seg_m,
  round(max(length_m)::numeric, 1)                                             AS max_seg_m
FROM roads_edges;

SELECT (SELECT count(*) FROM roads_vertices) AS vertices;

\timing off
