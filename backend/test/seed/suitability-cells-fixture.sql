-- ============================================================================
-- suitability_cells CI 测试夹具（选址域端点契约用，2026-10-03）
-- ============================================================================
-- 为什么需要（用户 2026-10-03 裁定「4a：只加 CI 种子」）：
-- 该表是选址端点的**预物化准则面**（真实库 14 万+ 格，物化脚本
-- tools/site-suitability/materialize-cells.sql）。CI seed 此前完全不灌它 ⇒
--   · `/nest-api/site-suitability/map` 在 CI 里只能以 5xx 收场，
--     端点的**契约**（FeatureCollection 形状 / properties.id 类型 / 聚合分辨率回显）
--     在 CI 里零覆盖；
--   · 2026-10-01 的生产事故（bigint id 被 pg 驱动返回字符串 ⇒ 前端 zod 校验失败、
--     页面永远"暂无数据"）只有单测兜着，HTTP 那一层没有回归。
-- 本夹具提供**最小可算的合成格网**（7 行），让上述契约在 CI 真库上跑真 SQL。
--
-- 为什么是合成而非真实子集：真实格网是 148k 行物化产物，随仓库分发不现实（体积红线），
--   且契约断言不应绑定生产数据分布。全量分布类断言仍由
--   `site-suitability-sensitivity.spec.ts`（V3_FULL_DATASET 门控，仅本地）承担。
--
-- 设计（钦州 qz，4490 经纬度直存，中心 ≈ 108.60, 21.90）：
--   · 7 格里 6 格 land_frac ≥ 0.5 —— 默认 min_land_frac=0.5 会**真的过滤掉**一格
--     （900004 land_frac=0.35），让"过滤发生了"成为可断言行为，而不是恰好全过；
--   · 900007 的 land_class / kde_mass 为 NULL —— 覆盖"缺因子"口径分支；
--   · id 落在 900001–900007 这段**夹具带**，与真实 id（现值量级 ≤1.5e5）天然不重叠。
--
-- ⚠️ 合成数据，**严禁灌入本地开发库/生产库**（红线同 roads-graph-fixture.sql）。
--    安全阀：库内已有任何夹具带之外的行即整体拒绝执行、不删任何数据。
-- 幂等：只删自己（id 在夹具带内）后重灌；可重复执行。
--
-- 🔒 整脚本包在**单个事务**里：`psql -f` 默认遇错继续，安全阀若不在事务内，
--    RAISE EXCEPTION 之后的 DELETE/INSERT 会照常执行（site-analysis-fixture 初版踩过）。
-- ============================================================================

BEGIN;

DO $$
DECLARE
  alien bigint;
BEGIN
  SELECT count(*) INTO alien FROM suitability_cells WHERE id NOT BETWEEN 900001 AND 900007;
  IF alien > 0 THEN
    RAISE EXCEPTION
      '拒绝灌入合成夹具：suitability_cells 已有 % 行非夹具数据（id 不在 900001–900007）。'
      '本夹具仅用于 CI 空库或专用测试库；请勿对 beibu-gulf-data / 生产库执行。', alien;
  END IF;
END $$;

DELETE FROM suitability_cells WHERE id BETWEEN 900001 AND 900007;

-- 列序：id, geom, mean_elev_m, mean_slope_deg, max_slope_deg, land_frac, land_class,
--       dist_port_m, dist_road_m, kde_mass
INSERT INTO suitability_cells
  (id, geom, mean_elev_m, mean_slope_deg, max_slope_deg, land_frac, land_class, dist_port_m, dist_road_m, kde_mass)
VALUES
  (900001, ST_SetSRID(ST_MakePoint(108.6000, 21.9000), 4490),  12,  1.2,  2.0, 0.92, 50, 1200,  150, 0.80),
  (900002, ST_SetSRID(ST_MakePoint(108.6080, 21.9040), 4490),  38,  6.5,  9.0, 0.71, 30, 2500,  400, 0.55),
  (900003, ST_SetSRID(ST_MakePoint(108.5960, 21.8960), 4490),   6,  0.6,  1.0, 1.00, 60,  800,   90, 0.95),
  (900004, ST_SetSRID(ST_MakePoint(108.6160, 21.9080), 4490), 120, 18.0, 25.0, 0.35, 20, 6000, 2000, 0.05),
  (900005, ST_SetSRID(ST_MakePoint(108.6040, 21.8920), 4490),  60, 12.0, 16.0, 0.55, 10, 4000,  900, 0.30),
  (900006, ST_SetSRID(ST_MakePoint(108.6120, 21.9000), 4490),  20,  3.0,  5.0, 0.80, 40, 3500,  700, 0.60),
  (900007, ST_SetSRID(ST_MakePoint(108.5920, 21.9040), 4490),  25,  4.0,  6.0, 0.65, NULL, 3000, 500, NULL);

COMMIT;
