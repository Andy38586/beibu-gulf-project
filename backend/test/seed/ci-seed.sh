#!/usr/bin/env bash
# ============================================================================
# C4 CI seed：v3_dev schema + 仓库内真数据 + roads_noded 最小夹具（幂等可重复执行）
# ============================================================================
# 由 ci.yml 的 backend-tests job 在 PostGIS+pgRouting service container 就绪后调用；
# 连接参数经环境注入，默认对齐 docker-compose.v3.yml（postgres/postgres/v3_dev@localhost:5432）。
# service 镜像用 pgrouting/pgrouting（postgis/postgis:16-3.4 无 pgRouting 扩展，
# route 域 pgr_withPoints 无法执行——2026-09-12 本地 probe 实证）。
#
# 灌数清单（① ② ③ 全部为随仓库分发的真数据，符合数据红线；④ 为唯一合成夹具）：
#   ① schema：tools/db/db-schema.sql / db-schema-gis.sql / db-schema-flood.sql（IF NOT EXISTS 幂等）
#   ② tools/db/db-import.mjs：ports 3 / flood_facilities 83 / data_archive 13
#     （users/plans/favorites 为运行时数据不入仓库，测试自建自清）
#   ③ tools/flood/flood-levels-to-pg.mjs：flood_levels 251 档
#     （backend/data/flood/flood_levels.json.gz，0.1m 步长真数据）
#   ④ backend/test/seed/roads-noded-fixture.sql：2 条合成测试边（⚠️ 仅测试库用，
#     严禁灌 v3_dev/生产库），让 route 域 pgr_withPoints / 吸附 / 分段费用真链路可跑
#     （真实路网 61 万段 + noding 流水线 CI 无法复现）
#
# POI/xiaoqu 有意不灌：AMap 抓取源不入仓库（tools/.poi_cache gitignored，无快照）→
# site-analysis.parity / site-analysis.e2e 两个数据绑定 spec 以库内 POI 计数自探测跳过
#（见两文件头注释）；本地 v3_dev 有全量数据照常运行。
#
# 本地联调等价命令（起 beibu-postgis 后逐条参照 tools/db 各脚本头注释执行；
# 勿对本机 v3_dev 跑 ④——夹具注释与红线均禁止）。
# ============================================================================
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-v3_dev}"
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

echo "[seed] roads_noded 最小夹具（仅测试库）..."
psql_run -q -f "$ROOT/backend/test/seed/roads-noded-fixture.sql"

echo "[seed] 灌数对账自检..."
counts="$(psql_run -t -A -c "SELECT (SELECT count(*) FROM flood_levels) || '/' || (SELECT count(*) FROM flood_facilities) || '/' || (SELECT count(*) FROM roads_noded WHERE cost_m > 0 AND main_comp IS TRUE)")"
echo "[seed] flood_levels/flood_facilities/roads_noded(可通行) = $counts"
[ "$counts" = "251/83/2" ] || { echo "::error::seed 对账不符（期望 251/83/2）"; exit 1; }
echo "[seed] 完成"
