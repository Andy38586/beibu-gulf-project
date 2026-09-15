-- ============================================================================
-- poi_facilities / xiaoqu CI 测试夹具（选址域契约测试用，2026-09-15）
-- ============================================================================
-- 为什么需要：site-analysis 全链路（POI/xiaoqu 取数 → buffer → 求交 → 评分 → TOP_N）此前
-- 在 CI 里**完全没被覆盖**——`site-analysis.e2e-spec.ts` 用 probePoiCount() 自探测，
-- CI seed 不灌 POI/xiaoqu（AMap 抓取源不入库）⇒ poiCount=0 ⇒ 整组 16 条静默跳过，
-- 且因 test-gate.config.json 登记为 mode=gated（env 已设不许跳）而**导致 CI 必红**
--（2026-09-15 实测：GATED_SKIP_IN_REQUIRED_ENV，watchdog 退出 1）。
--
-- 本夹具提供**最小可算的合成数据集**，让选址链路的**契约与不变量**能在 CI 真库上跑真 SQL。
--
-- 为什么是合成而非真实子集：AMap 抓取源不入仓库（红线），且契约断言不应绑定生产数据分布。
-- 真实数据分布的**快照断言**已拆入 `site-analysis.snapshot.spec.ts`（V3_FULL_DATASET 门控，仅本地）。
--
-- 设计（钦州 qz，中心 ≈ 108.603, 21.902）：
--   · hospital 3 点、park 3 点，两簇相距约 0.5km → 各自 3km 缓冲的并集必然相交，
--     交集覆盖中心 ~6km 宽区域（断言体系依赖"有交集"这一前提）。
--   · xiaoqu 12 点，全部落在中心 ~2km 内 → 全部命中交集，触发 TOP_N 截断（10）。
--   · 12 > TOP_N=10 是有意为之：让"截断"成为可断言的行为，而不是恰好等于上限。
--
-- ⚠️ 合成数据，**严禁灌入本地开发库/生产库**（红线同 roads-graph-fixture.sql）。
--    安全阀：库内已有任何非夹具行（id 不以 TF- 开头）即整体拒绝执行、不删任何数据。
-- 幂等：只删自己（id LIKE 'TF-%'）后重灌；可重复执行。
--
-- 🔒 整个脚本包在**单个事务**里（2026-09-15 加固）：安全阀在任何情况下都真的拦得住。
--    教训：`psql -f` **默认遇错继续**——若调用方漏了 `-v ON_ERROR_STOP=1`，
--    RAISE EXCEPTION 之后 DELETE/INSERT 会照常执行（本文件初版实测在真实库上灌进了 18 行）。
--    ci-seed.sh 的 psql_run 已带 ON_ERROR_STOP=1，但夹具不应把安全性寄托在调用方参数上：
--    事务内一旦抛错，后续语句全部 "transaction is aborted" 被忽略、COMMIT 退化为 ROLLBACK
--    ⇒ 无论调用方怎么调，都不会写脏数据。
-- ============================================================================

BEGIN;

DO $$
DECLARE
  real_poi   int;
  real_xq    int;
BEGIN
  SELECT count(*) INTO real_poi FROM poi_facilities WHERE id NOT LIKE 'TF-%';
  SELECT count(*) INTO real_xq  FROM xiaoqu         WHERE id NOT LIKE 'TF-%';
  IF real_poi > 0 OR real_xq > 0 THEN
    RAISE EXCEPTION
      '拒绝灌入合成夹具：库内已有真实数据（poi_facilities % 行 / xiaoqu % 行，均为非 TF- 前缀）。'
      '本夹具仅用于 CI 空库或专用测试库；请勿对 beibu-gulf-data / 生产库执行。', real_poi, real_xq;
  END IF;
END $$;

DELETE FROM poi_facilities WHERE id LIKE 'TF-%';
DELETE FROM xiaoqu         WHERE id LIKE 'TF-%';

-- ── hospital（3 点，簇心 108.6000, 21.9000）────────────────────────────────
INSERT INTO poi_facilities (id, type, name, district, city, geom) VALUES
  ('TF-H-001', 'hospital', '[夹具]钦州中心医院', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6000, 21.9000), 4490)),
  ('TF-H-002', 'hospital', '[夹具]钦州第二医院', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6040, 21.9020), 4490)),
  ('TF-H-003', 'hospital', '[夹具]钦州城南卫生院', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.5980, 21.8980), 4490));

-- ── park（3 点，簇心 108.6053, 21.9033，与医院簇相距约 0.5km）──────────────
INSERT INTO poi_facilities (id, type, name, district, city, geom) VALUES
  ('TF-P-001', 'park', '[夹具]钦州中心公园', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6060, 21.9040), 4490)),
  ('TF-P-002', 'park', '[夹具]钦州滨江公园', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6020, 21.9060), 4490)),
  ('TF-P-003', 'park', '[夹具]钦州南湖公园', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6080, 21.9000), 4490));

-- ── xiaoqu（12 点，全部落在中心 ~2km 内 → 命中交集并触发 TOP_N 截断）──────
INSERT INTO xiaoqu (id, name, district, city, geom) VALUES
  ('TF-X-001', '[夹具]和谐小区 01', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6030, 21.9020), 4490)),
  ('TF-X-002', '[夹具]和谐小区 02', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6045, 21.9035), 4490)),
  ('TF-X-003', '[夹具]和谐小区 03', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6015, 21.9005), 4490)),
  ('TF-X-004', '[夹具]和谐小区 04', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6060, 21.9010), 4490)),
  ('TF-X-005', '[夹具]和谐小区 05', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6000, 21.9040), 4490)),
  ('TF-X-006', '[夹具]和谐小区 06', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6075, 21.9050), 4490)),
  ('TF-X-007', '[夹具]和谐小区 07', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.5990, 21.9015), 4490)),
  ('TF-X-008', '[夹具]和谐小区 08', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6050, 21.8985), 4490)),
  ('TF-X-009', '[夹具]和谐小区 09', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6025, 21.9060), 4490)),
  ('TF-X-010', '[夹具]和谐小区 10', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6090, 21.9025), 4490)),
  ('TF-X-011', '[夹具]和谐小区 11', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.5975, 21.9035), 4490)),
  ('TF-X-012', '[夹具]和谐小区 12', '钦南区', 'qz', ST_SetSRID(ST_MakePoint(108.6040, 21.9055), 4490));

-- 对账（seed 日志用）：夹具应为 poi 6 / xiaoqu 12
DO $$
DECLARE
  n_poi int;
  n_xq  int;
BEGIN
  SELECT count(*) INTO n_poi FROM poi_facilities WHERE id LIKE 'TF-%';
  SELECT count(*) INTO n_xq  FROM xiaoqu         WHERE id LIKE 'TF-%';
  RAISE NOTICE '[site-analysis-fixture] poi_facilities=% xiaoqu=%', n_poi, n_xq;
  IF n_poi <> 6 OR n_xq <> 12 THEN
    RAISE EXCEPTION '夹具对账不符：期望 poi=6 / xiaoqu=12，实际 poi=% / xiaoqu=%', n_poi, n_xq;
  END IF;
END $$;

COMMIT;
