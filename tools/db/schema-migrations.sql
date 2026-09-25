-- =============================================================================
-- 迁移登记表 schema_migrations（z050，2026-09-26 用户裁定「新建 schema_migrations 表」）
-- =============================================================================
-- 治什么：部署只做「pull 代码 + 起镜像」，库对象（表/索引/扩展/参数表）全靠人工执行 SQL，
-- 且无登记、无核对 → 2026-09-12 两起事故同源：
--   ① 浸没分析 500 —— 生产缺 admin_boundary / admin_boundary_union（陆域裁剪依赖）；
--   ② 航线分析 26s —— roads_noded 缺路由索引（每次查询全堆扫描 765MB）。
-- 登记表把「哪些迁移已执行」变成库内可查的事实；部署后的只读核对
-- （tools/db/verify-data-readiness.sql，已接入 .github/workflows/ci.yml 的 deploy 段）
-- 会 fail-loud 地断言本表存在且非空，从而拦住「代码上线、库没跟上」。
--
-- 幂等：CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING，可重复执行。
--
-- ── 历史库一次性补录（z050）──────────────────────────────────────────────
-- 机制建立前已执行的迁移没有登记行，须一次性补录。步骤（服务器，仓库目录下）：
--   1) 确认已 git pull 到含本文件的 HEAD；
--   2) docker exec -i beibu-postgis psql -U postgres -d beibu-gulf-data -v ON_ERROR_STOP=1 \
--        < tools/db/schema-migrations.sql
--   3) 核对：docker exec -i beibu-postgis psql -U postgres -d beibu-gulf-data \
--        -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
--   4) ⚠️ 下面 IN 清单是**仓库脚本清单**，不是服务器实际执行记录。补录时逐一核对：
--        · 服务器**没执行过**的条目 → 从本文件删掉该行（或先执行对应脚本再登记）；
--        · 服务器执行过、清单里没有的 → 手工补一行：
--            INSERT INTO schema_migrations (version, notes) VALUES ('<脚本名>', '补录');
--      补齐后重跑本脚本（ON CONFLICT DO NOTHING，不会覆盖已有行）。
--   5) 补录完毕后，后续每次部署的后置只读核对即会通过。
--
-- ── 新增迁移的登记纪律 ────────────────────────────────────────────────
-- 迁移脚本按序号命名（如 `0007-roads-graph-v2.sql`），执行成功的**同一次**里登记：
--   INSERT INTO schema_migrations (version, notes) VALUES ('0007-roads-graph-v2', '路网 v2');
-- 版本号 = 脚本文件名去扩展名，与 tools/db/、tools/roads/ 下的脚本一一对应。
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,               -- 迁移标识 = 脚本文件名（去 .sql）
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes      TEXT
);

-- 历史补录（2026-09-26 一次性）：机制建立前随仓库分发、已在生产库执行过的迁移脚本。
-- ⚠️ 这是**历史事实的一次性快照**，不是需要随代码演进的清单；将来新增迁移按上面的
--    登记纪律逐条 INSERT，不再回到这里追加。
INSERT INTO schema_migrations (version, notes) VALUES
  ('db-schema',                   '核心 schema（users/plans/favorites/ports 等），历史补录'),
  ('db-schema-gis',               'GIS 图层表（OSM 派生线/面等），历史补录'),
  ('db-schema-flood',             'flood 域 schema（flood_levels/flood_facilities/admin_boundary 等），历史补录'),
  ('register-spatial-meta',       '坐标系元数据登记（spatial_meta 10 行），历史补录'),
  ('roads-noded-indexes',         'roads_noded 路由索引（2026-09-12 航线 26s 事故补丁），历史补录'),
  ('inspection-views',            '巡检视图，历史补录'),
  ('backfill-facility-elevation', '设施高程回填 83/83（z049），历史补录')
ON CONFLICT (version) DO NOTHING;
