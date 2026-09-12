-- ============================================================================
-- roads_edges / roads_vertices CI 测试夹具（v2 路网，2026-09-13）
-- ============================================================================
-- 为什么需要：route 域 SQL（pgr_withPoints 有向寻路）依赖 tools/roads/roads-graph-build.sql
-- 从真实 OSM 构建的 roads_edges（400,812 段 / 313,017 顶点）。CI 复现不了该流水线
-- （需 4 份省级 PBF 共 340MB + pyosmium），故提供最小可通行**有向**路网夹具，让 route e2e
-- 的真链路（吸附 / 有向最短路 / 分段费用折算）在 CI 真库上跑真 SQL。
--
-- 夹具刻意覆盖三种形态（都是 2026-09-12 复盘里出过问题的）：
--   · 两条边首尾相接于 node 2 = 度 2 拼接点（OSM 因限速/桥隧把一条路拆成多条 way 的常态）
--   · **一条单向边**（edge C：oneway=1 → reverse_cost_m = -1）——旧网 oneway 全 NULL 且
--     pgr 以 directed := false 跑，"单行道不可逆行"在 CI 里根本测不到；现在成为断言。
--   · 顶点表齐备 + 等级参数齐备（db-readiness.spec.ts 断言的图完整性前提）
--
-- 坐标对齐 route.e2e-spec.ts 的既有用例（108.6,21.6 → 108.7,21.7 与 108.8,21.8 → 108.75,21.75），
-- 确保换夹具不改变这两个用例的语义。
--
-- ⚠️ 合成数据，严禁灌入本地开发库/生产库（红线同已删除的 roads-noded-fixture）。
-- 幂等：CREATE TABLE IF NOT EXISTS + DELETE 后重灌；>100 行视为真数据并拒绝清空。
-- ============================================================================

CREATE TABLE IF NOT EXISTS roads_vertices (
  node_id bigint PRIMARY KEY,
  geom    geometry(Point, 4490) NOT NULL
);

CREATE TABLE IF NOT EXISTS roads_edges (
  id                     bigint PRIMARY KEY,
  way_id                 bigint NOT NULL,
  seg                    int    NOT NULL,
  source                 bigint NOT NULL,
  target                 bigint NOT NULL,
  class                  text   NOT NULL,
  name                   text,
  ref                    text,
  oneway                 smallint NOT NULL,
  bridge                 boolean NOT NULL DEFAULT false,
  tunnel                 boolean NOT NULL DEFAULT false,
  layer                  int     NOT NULL DEFAULT 0,
  maxspeed_kph           int,
  speed_kph              numeric(5,1) NOT NULL,
  access                 text,
  junction               text,
  length_m               numeric(10,2) NOT NULL,
  cost_m                 numeric(10,2) NOT NULL,
  reverse_cost_m         numeric(10,2) NOT NULL,
  cost_min               numeric(10,4) NOT NULL,
  reverse_cost_min       numeric(10,4) NOT NULL,
  route_cost_min         numeric(10,4) NOT NULL,
  route_reverse_cost_min numeric(10,4) NOT NULL,
  main_comp              boolean NOT NULL DEFAULT false,
  geom                   geometry(LineString, 4490) NOT NULL
);

CREATE TABLE IF NOT EXISTS route_class_profile (
  highway      text PRIMARY KEY,
  speed_kph    numeric(5,1) NOT NULL,
  drivable     boolean      NOT NULL,
  pref_penalty numeric(4,2) NOT NULL,
  note         text         NOT NULL DEFAULT ''
);

-- 红线护栏：目标库 roads_edges 已有 >100 行 ⇒ 是真路网，拒绝洗表（防误灌开发/生产库）
DO $$
DECLARE existing_rows bigint;
BEGIN
  SELECT count(*) INTO existing_rows FROM roads_edges;
  IF existing_rows > 100 THEN
    RAISE EXCEPTION 'roads_edges 已有 % 行，疑似真实路网——本夹具严禁灌入开发/生产库，已中止',
      existing_rows;
  END IF;
END $$;

DELETE FROM roads_edges;
DELETE FROM roads_vertices;

-- 等级参数：只补夹具用到的 secondary（真库已有 32 条，不覆盖）
INSERT INTO route_class_profile (highway, speed_kph, drivable, pref_penalty, note)
VALUES ('secondary', 50, true, 1.02, 'CI 夹具用')
ON CONFLICT (highway) DO NOTHING;

-- 顶点：node1(108.6,21.6) — node2(108.7,21.7) — node3(108.8,21.8) — node4(108.9,21.9)
INSERT INTO roads_vertices (node_id, geom) VALUES
  (900000001, ST_SetSRID(ST_MakePoint(108.6, 21.6), 4490)),
  (900000002, ST_SetSRID(ST_MakePoint(108.7, 21.7), 4490)),
  (900000003, ST_SetSRID(ST_MakePoint(108.8, 21.8), 4490)),
  (900000004, ST_SetSRID(ST_MakePoint(108.9, 21.9), 4490));

-- 边：
--   A/B 双向各约 7.8km（cost_min 按 50km/h = 9.39 分钟，与 route_class_profile 一致）
--   C   单向 3→4（about 15.6km，30km/h = 31.3 分钟）：正向可走、反向 -1
INSERT INTO roads_edges
  (id, way_id, seg, source, target, class, name, oneway, length_m,
   cost_m, reverse_cost_m, cost_min, reverse_cost_min,
   route_cost_min, route_reverse_cost_min, speed_kph, main_comp, geom)
VALUES
  (1, 9000001, 0, 900000001, 900000002, 'secondary', 'ci-fixture-a', 0, 7826.00,
   7826.00, 7826.00, 9.3912, 9.3912, 9.5787, 9.5787, 50, TRUE,
   ST_SetSRID(ST_GeomFromText('LINESTRING(108.6 21.6, 108.65 21.65, 108.7 21.7)'), 4490)),
  (2, 9000002, 0, 900000002, 900000003, 'secondary', 'ci-fixture-b', 0, 7826.00,
   7826.00, 7826.00, 9.3912, 9.3912, 9.5787, 9.5787, 50, TRUE,
   ST_SetSRID(ST_GeomFromText('LINESTRING(108.7 21.7, 108.75 21.75, 108.8 21.8)'), 4490)),
  (3, 9000003, 0, 900000003, 900000004, 'secondary', 'ci-fixture-oneway', 1, 15652.00,
   15652.00, -1, 31.3040, -1, 31.9301, -1, 30, TRUE,
   ST_SetSRID(ST_GeomFromText('LINESTRING(108.8 21.8, 108.85 21.85, 108.9 21.9)'), 4490));

-- 夹具自检：① 可通行主分量边 ≥3；② 每条边两端都有顶点；③ 至少一条单向边且反向为 -1
DO $$
DECLARE
  n int;
  bad int;
BEGIN
  SELECT count(*) INTO n
    FROM roads_edges WHERE (cost_m > 0 OR reverse_cost_m > 0) AND main_comp IS TRUE;
  IF n < 3 THEN
    RAISE EXCEPTION 'roads_edges CI 夹具自检失败：可通行主分量边数 % < 3', n;
  END IF;

  SELECT count(*) INTO bad
    FROM roads_edges e
   WHERE NOT EXISTS (SELECT 1 FROM roads_vertices v WHERE v.node_id = e.source)
      OR NOT EXISTS (SELECT 1 FROM roads_vertices v WHERE v.node_id = e.target);
  IF bad > 0 THEN
    RAISE EXCEPTION 'roads_edges CI 夹具自检失败：% 条边的端点无顶点', bad;
  END IF;

  SELECT count(*) INTO n FROM roads_edges WHERE oneway <> 0 AND reverse_cost_m = -1;
  IF n = 0 THEN
    RAISE EXCEPTION 'roads_edges CI 夹具自检失败：夹具必须含单向边（否则有向断言无意义）';
  END IF;
END $$;

-- 与 roads-graph-build.sql 【5】同款的索引：db-readiness.spec.ts 断言其存在，
-- 作为「建图脚本 ↔ 库对象」一致性护栏
CREATE INDEX IF NOT EXISTS idx_roads_edges_geom_usable ON roads_edges USING GIST (geom)
  WHERE (cost_m > 0 OR reverse_cost_m > 0);
CREATE INDEX IF NOT EXISTS idx_roads_edges_routing ON roads_edges (id)
  INCLUDE (source, target, cost_m, reverse_cost_m, cost_min, reverse_cost_min)
  WHERE main_comp IS TRUE;
CREATE INDEX IF NOT EXISTS idx_roads_vertices_geom ON roads_vertices USING GIST (geom);
