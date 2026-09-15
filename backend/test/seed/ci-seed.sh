#!/usr/bin/env bash
# ============================================================================
# C4 CI seed：beibu-gulf-data schema + 仓库内真数据 + roads_edges 最小夹具（幂等可重复执行）
# ============================================================================
# 由 ci.yml 的 backend-tests job 在 PostGIS+pgRouting service container 就绪后调用；
# 连接参数经环境注入，默认对齐 docker-compose.v3.yml（postgres/postgres/beibu-gulf-data@localhost:5432）。
# service 镜像用 pgrouting/pgrouting（postgis/postgis:16-3.4 无 pgRouting 扩展，
# route 域 pgr_withPoints 无法执行——2026-09-12 本地 probe 实证）。
#
# 灌数清单（① ② ③ 全部为随仓库分发的真数据，符合数据红线；④ 为唯一合成夹具）：
#   ① schema：tools/db/db-schema.sql / db-schema-gis.sql / db-schema-flood.sql（IF NOT EXISTS 幂等）
#   ② tools/db/db-import.mjs：ports 3 / flood_facilities 83 / data_archive 13
#     （users/plans/favorites 为运行时数据不入仓库，测试自建自清）
#   ③ tools/flood/flood-levels-to-pg.mjs：flood_levels 251 档
#     （backend/data/flood/flood_levels.json.gz，0.1m 步长真数据）
#   ④ backend/test/seed/roads-graph-fixture.sql：3 条合成测试边（⚠️ 仅测试库用，
#     严禁灌 beibu-gulf-data/生产库），含一条**单向边**，让 route 域有向 pgr_withPoints /
#     吸附 / 分段费用真链路可跑（真实路网 40 万段 + 省级 PBF 抽取流水线 CI 无法复现）
#   ⑤ backend/test/seed/site-analysis-fixture.sql：合成 poi 6 / xiaoqu 12（⚠️ 仅测试库用），
#     让选址域（buffer → 求交 → 评分 → TOP_N）的**契约与不变量**在 CI 跑真 SQL。
#
# 为什么原「POI/xiaoqu 有意不灌」被推翻（2026-09-15）：当时理由是 AMap 抓取源不入仓库
# （tools/.poi_cache gitignored，无快照），故 site-analysis 两个数据绑定 spec 自探测跳过。
# 但该"诚实跳过"与 test-gate.config.json 的 mode=gated 语义冲突（CI 设了 V3_INTEGRATION_DB
# 就不许有跳过）⇒ **CI 必红**（实测 GATED_SKIP_IN_REQUIRED_ENV，watchdog 退出 1），
# 且选址全链路在 CI 长期零覆盖。修法不是放松登记，而是**补一份最小合成夹具**（⑤）：
#   · 契约与不变量 → 进 CI（对着 ⑤ 跑，对全量真实数据同样成立）；
#   · 绑定全量数据分布的快照断言 → 拆入 site-analysis.snapshot.spec.ts（V3_FULL_DATASET，仅本地）。
#
# 本地联调等价命令（起 beibu-postgis 后逐条参照 tools/db 各脚本头注释执行；
# 勿对本机 beibu-gulf-data 跑 ④——夹具注释与红线均禁止）。
# ============================================================================
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-beibu-gulf-data}"
export PGPASSWORD

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

command -v psql >/dev/null 2>&1 || { echo "::error::psql 客户端不可用（apt install postgresql-client）"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "::error::node 不可用"; exit 1; }

psql_run() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 "$@"; }

echo "[seed] 等待 PostGIS 就绪 ${PGHOST}:${PGPORT}/${PGDATABASE} ..."
ready=0
for _ in $(seq 1 30); do
  if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" -eq 1 ] || { echo "::error::PostGIS 60s 未就绪"; exit 1; }

echo "[seed] 扩展（postgis/pgrouting）+ schema（IF NOT EXISTS 幂等）..."
psql_run -q -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgrouting;"
for f in db-schema.sql db-schema-gis.sql db-schema-flood.sql; do
  psql_run -q -f "$ROOT/tools/db/$f"
done

echo "[seed] 仓库内真数据（ports 3 / flood_facilities 83 / data_archive 13）..."
(cd "$ROOT" && node tools/db/db-import.mjs >/dev/null)
psql_run -q -f "$ROOT/.local/tmp/import.sql"

echo "[seed] flood_levels 251 档真数据（flood_levels.json.gz）..."
(cd "$ROOT" && node tools/flood/flood-levels-to-pg.mjs >/dev/null)
psql_run -q -f "$ROOT/.local/tmp/flood-import.sql"

echo "[seed] roads_edges 最小夹具（仅测试库）..."
psql_run -q -f "$ROOT/backend/test/seed/roads-graph-fixture.sql"

# 2026-09-15：选址域合成夹具。此前 CI 不灌 POI/xiaoqu ⇒ site-analysis 全链路在 CI 恒跳过，
# 而 test-gate.config.json 又登记为 mode=gated（env 已设不许跳）⇒ watchdog 判红。
# 夹具提供最小可算数据集（poi 6 / xiaoqu 12，坐标钦州），让选址契约与不变量在 CI 跑真 SQL。
# 安全阀：库内已有非 TF- 前缀行即整体拒绝（事务回滚），不会污染真实库。
echo "[seed] poi_facilities/xiaoqu 合成夹具（选址域契约测试用，仅测试库）..."
psql_run -q -f "$ROOT/backend/test/seed/site-analysis-fixture.sql"

echo "[seed] 灌数对账自检..."
counts="$(psql_run -t -A -c "SELECT (SELECT count(*) FROM flood_levels) || '/' || (SELECT count(*) FROM flood_facilities) || '/' || (SELECT count(*) FROM roads_edges WHERE main_comp IS TRUE) || '/' || (SELECT count(*) FROM poi_facilities WHERE id LIKE 'TF-%') || '/' || (SELECT count(*) FROM xiaoqu WHERE id LIKE 'TF-%')")"
echo "[seed] flood_levels/flood_facilities/roads_edges(主分量)/poi夹具/xiaoqu夹具 = $counts"
[ "$counts" = "251/83/3/6/12" ] || { echo "::error::seed 对账不符（期望 251/83/3/6/12）"; exit 1; }
echo "[seed] 完成"
