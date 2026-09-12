-- =============================================================================
-- roads_noded 路由索引迁移（幂等，可重复执行；只加索引，不改数据）
-- =============================================================================
-- ⚠️ **状态（2026-09-13）**：本补丁是**旧表 roads_noded 的止痛**，仍可在未迁移到 v2 前先上
--    （26s 事故的直接病因：无 id 索引 → 每次查询全堆扫描 765MB）。
--    但根治方向是路网 v2（tools/roads/roads-graph-build.sql）：表换 `roads_edges`、
--    有向代价、覆盖索引（predicate 与 edges_sql 逐字一致）——v2 上线后本文件即历史。
--
-- 背景（2026-09-12 生产事故）：航线分析 /route/path 在生产 26s 才返回
--（实测 3.3km 短途同样 26.9s——耗时与路径长短无关，是**每查询固定成本**），
-- 前端 10s 超时 × 3 次重试 → 用户看到「无响应」。
--
-- 本地真库（614,015 段真路网）复现定位：roads_noded 是 CREATE TABLE AS 产物
--（无主键、无 id 索引），表宽 765MB（几何占绝大部分），而三处 SQL 都在读它：
--   · pgr_withPoints 的 edges_sql（构图）——无可用索引 → 全堆扫描（单次读 ~640MB）
--   · sumSegmentCosts / segmentGeometry 的 `JOIN roads_noded ON id = ...` ——同样全堆扫描
-- 本地（暖缓存 + 快盘）合计 1.17s，看着"还行"；生产 VPS（慢盘 + shared_buffers 64MB
-- + 冷缓存）同样的读取量放大成 26s。
--
-- 修复：两个索引把图读取降到 28MB（index-only scan），JOIN 降到按主键点查：
--   · idx_roads_noded_id      —— 三处 `JOIN roads_noded ON e.id = ...` 的点查路径
--   · idx_roads_noded_routing —— 覆盖索引（INCLUDE 构图所需四列），谓词与 edges_sql 逐字一致
--
-- ⚠️ VACUUM (ANALYZE) 不可省：index-only scan 依赖 visibility map，缺它规划器会
--    回退全堆扫描（本地实测）。VACUUM 不能进事务块，故单独执行；并行 VACUUM 会撞
--    docker 默认 64MB /dev/shm（"could not resize shared memory segment"），先关并行。
--
-- 用法（服务器，仓库目录下）：
--   docker exec -i beibu-postgis psql -U postgres -d v3_dev -v ON_ERROR_STOP=1 \
--     < tools/db/roads-noded-indexes.sql
--
-- 本地实测（614,015 段真路网，钦州 17.6km 路径，见 route-verify.sql）：
--   修复前 pgr 调用 1.17s / 读 ~98k 页；修复后 0.48s / 读 3.5k 页（28MB）
--
-- 回滚（索引是纯增益，一般不需要）：
--   DROP INDEX IF EXISTS idx_roads_noded_id, idx_roads_noded_routing;
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

SET max_parallel_maintenance_workers = 0;

BEGIN;
-- 三处 JOIN 的点查路径（旧表为 CREATE TABLE AS 产物，无主键，此索引不可省）
CREATE INDEX IF NOT EXISTS idx_roads_noded_id
  ON roads_noded (id);

-- 路由图覆盖索引：谓词与 route.repository.ts 的 edges_sql 逐字一致（cost_m>0 AND
-- main_comp IS TRUE AND source/target NOT NULL），INCLUDE 四列使构图全程 index-only
CREATE INDEX IF NOT EXISTS idx_roads_noded_routing
  ON roads_noded (id) INCLUDE (source, target, cost_m, cost_min)
  WHERE cost_m > 0 AND main_comp IS TRUE AND source IS NOT NULL AND target IS NOT NULL;
COMMIT;

-- index-only scan 的前提（须在事务外）
VACUUM (ANALYZE) roads_noded;

-- -----------------------------------------------------------------------------
-- 自检 1：索引清单（应能看到 idx_roads_noded_id 与 idx_roads_noded_routing）
-- -----------------------------------------------------------------------------
SELECT indexname,
       pg_size_pretty(pg_relation_size(('public.' || indexname)::regclass)) AS size
FROM pg_indexes
WHERE tablename = 'roads_noded'
ORDER BY indexname;

-- -----------------------------------------------------------------------------
-- 自检 2：构图子查询计划——期望 `Index Only Scan using idx_roads_noded_routing`
--（若仍是 Seq Scan，先确认上面的 VACUUM 成功执行、且表无并发写）
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, source, target, cost_m, cost_min
FROM roads_noded
WHERE cost_m > 0 AND main_comp IS TRUE AND source IS NOT NULL AND target IS NOT NULL;

\echo '===== 完成：请用 curl 复验 /nest-api/route/path 耗时（期望 < 5s）====='
