-- ============================================================================
-- roads_noded CI 测试夹具（仅供 CI/本地 seed 后的门控测试使用，非业务数据）
-- ============================================================================
-- 为什么需要：route 域 SQL（pgr_withPoints 寻路）依赖 tools/roads/roads-noding.sql
-- 从真实 OSM 路网（~61 万段）构建的 roads_noded 拓扑表。该构建需 83MB 源数据 +
-- 分钟级 SQL 流水线，CI 无法复现 → 提供最小可通行路网夹具，让 route e2e 的
-- 「寻路契约」在 CI 真库上跑真 SQL（pgr_withPoints / 吸附 / 分段费用全链路），
-- 而不是因表不存在 500。
--
-- 列集与生产 roads_noded 对齐（roads-noding.sql 【3】表结构 + 【4】【5】【6】拓扑/
-- 费用/主分量列）；数据为 2 条首尾相接的测试边，覆盖 route.e2e 的寻路坐标
-- （108.6,21.6 → 108.7,21.7）。⚠️ 合成数据，严禁灌入生产/本地开发库（v3_dev）。
-- 幂等：CREATE TABLE IF NOT EXISTS + DELETE 后重灌。
-- ============================================================================

CREATE TABLE IF NOT EXISTS roads_noded (
  id        BIGSERIAL PRIMARY KEY,
  old_id    BIGINT,
  class     TEXT,
  osm_id    BIGINT,
  name      TEXT,
  highway   TEXT,
  length_m  DOUBLE PRECISION,
  source    INTEGER,
  target    INTEGER,
  cost_m    DOUBLE PRECISION,
  cost_min  DOUBLE PRECISION,
  main_comp BOOLEAN DEFAULT TRUE,
  geom      geometry(LineString, 4490)
);

-- 红线护栏：本夹具仅限 CI / 专用测试库。若目标库 roads_noded 已有大量行
--（真实路网约 61 万段），说明跑错了库——拒绝清空，防止误灌开发/生产库把真路网洗掉。
-- 空表或已有本夹具（≤100 行）正常放行。
DO $$
DECLARE existing_rows bigint;
BEGIN
  SELECT count(*) INTO existing_rows FROM roads_noded;
  IF existing_rows > 100 THEN
    RAISE EXCEPTION 'roads_noded 已有 % 行，疑似真实路网——本夹具严禁灌入开发/生产库，已中止', existing_rows;
  END IF;
END $$;

TRUNCATE roads_noded RESTART IDENTITY;

-- 两条边首尾相接（节点 2 共享），合计约 15.6km，cost_min 按 30km/h 折算（对齐 noding 【5】口径）
INSERT INTO roads_noded
  (old_id, class, osm_id, name, highway, length_m, source, target, cost_m, cost_min, main_comp, geom)
VALUES
  (1, 'secondary', 9000001, 'ci-fixture-a', 'secondary',
   7826.00, 1, 2, 7826.00, 15.6520, TRUE,
   ST_SetSRID(ST_GeomFromText('LINESTRING(108.6 21.6, 108.65 21.65, 108.7 21.7)'), 4490)),
  (2, 'secondary', 9000002, 'ci-fixture-b', 'secondary',
   7826.00, 2, 3, 7826.00, 15.6520, TRUE,
   ST_SetSRID(ST_GeomFromText('LINESTRING(108.7 21.7, 108.75 21.75, 108.8 21.8)'), 4490));

-- 夹具自检：两条边均须进入可通行主分量
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM roads_noded WHERE cost_m > 0 AND main_comp IS TRUE;
  IF n < 2 THEN
    RAISE EXCEPTION 'roads_noded CI 夹具自检失败：可通行主分量边数 % < 2', n;
  END IF;
END $$;
