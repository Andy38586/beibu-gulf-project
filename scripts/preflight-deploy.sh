#!/usr/bin/env bash
# ============================================================
# 部署前置校验（preflight）—— 2026-09-17 新增
#
# 【为什么需要它】
#   docker-compose.yml 自 2026-09-15（P0 / EP-09 / EH-07）起对 POSTGRES_PASSWORD 使用
#   `${POSTGRES_PASSWORD:?...}` 强制校验——变量未设置时 compose 直接中断退出。
#   而 scripts/server-setup.sh 的 .env 模板从未生成该变量 ⇒ 9-16 的部署在 ssh 阶段
#   7 秒即红；ci.yml 当时把该处失败统一报成「git pull 阶段失败」，把排查方向带偏到
#   git/SSH 上去（实际 git pull 是成功的）。
#
# 【本脚本做什么】（幂等；只补齐配置，不改动数据库状态）
#   1) .env 已有 POSTGRES_PASSWORD → 直接进入第 3 步
#   2) .env 缺失 → 从**运行中的 beibu-postgis 容器环境变量**读回口令。
#      该值即 beibu-pgdata 卷首次初始化时用的口令；**卷已存在 ⇒ 此后改 .env 不会改动
#      库内口令**，所以必须填回同一个值，否则表现为「compose 起得来、nest 连不上库」，
#      且要等 30 分钟健康轮询才暴露。故此处：
#        · 读回后先用 TCP 回环实测该口令能否连库（容器内 local socket 是 trust，
#          验不了口令，必须走 TCP）
#        · 实测通过才写入 .env；不通过则明确报错退出——宁可不部署，也不写错值
#   3) `docker compose config` 预解析：把「变量缺失 / YAML 有误」从 30 分钟后的
#      部署超时，提前到部署前的即时明确报错
#
# 【输出为什么要走 stderr】
#   ci.yml 的 ssh_quick() 实现是 `ssh ... 2>&1 >/dev/null`：**stdout 被丢弃，只保留
#   stderr**。若本脚本把 ::error:: 打到 stdout，失败原因在 CI 日志里会整段消失，
#   只剩一句「远端命令失败(exit 1)」。故本脚本所有输出一律走 stderr（>&2）。
#
# 【明确不做的事】
#   ⚠️ 本脚本**不轮换口令**。轮换要 ALTER USER + 同步全部消费方，是独立的加固动作，
#      不应在部署链路上顺手做（否则会出现「库口令已改、旧容器仍在用旧口令」的窗口期，
#      把一次部署失败放大成一次生产连库故障）。轮换属独立待办。
#   ⚠️ 本脚本不写死任何口令字面量：口令值一律从服务器现有状态（容器环境变量）取得。
#
# 【用法】
#   bash scripts/preflight-deploy.sh [APP_DIR]     # 默认 /opt/beibu-gulf
#   退出码：0 = 可部署；非零 = 不允许部署（原因见 ::error:: 输出）
# ============================================================
set -euo pipefail

APP_DIR="${1:-/opt/beibu-gulf}"
PG_CONTAINER="beibu-postgis"
PG_DB="beibu-gulf-data"
PG_USER="postgres"

cd "$APP_DIR" || {
  echo "::error::preflight: 工作目录不存在：$APP_DIR" >&2
  exit 1
}
echo "==> preflight: 工作目录 $APP_DIR" >&2

# ── 1) POSTGRES_PASSWORD 是否已注入 ────────────────────────────────────
if grep -q '^POSTGRES_PASSWORD=' .env 2>/dev/null; then
  echo "==> preflight: .env 已含 POSTGRES_PASSWORD，跳过注入" >&2
else
  echo "==> preflight: .env 缺 POSTGRES_PASSWORD，尝试从 $PG_CONTAINER 容器读回现有口令" >&2
  PW="$(docker inspect "$PG_CONTAINER" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null |
    grep -m1 '^POSTGRES_PASSWORD=' | cut -d= -f2-)" || PW=""

  if [ -z "$PW" ]; then
    echo "::error::preflight: 读不到 POSTGRES_PASSWORD——$PG_CONTAINER 容器不存在或没有该环境变量。" >&2
    echo "::error::preflight: 请在服务器上确认库内真实口令后手动注入：" >&2
    echo "::error::preflight:   cd $APP_DIR && echo 'POSTGRES_PASSWORD=<现有库真实口令>' >> .env" >&2
    exit 1
  fi

  # 用回环 TCP 实测（非 local socket——socket 是 trust，任何口令都连得上，验不出对错）
  if docker exec -e PGPASSWORD="$PW" "$PG_CONTAINER" \
    psql -U "$PG_USER" -h 127.0.0.1 -d "$PG_DB" -tAc 'SELECT 1' >/dev/null 2>&1; then
    printf 'POSTGRES_PASSWORD=%s\n' "$PW" >> .env
    chmod 600 .env
    echo "==> preflight: 已写入 .env（值 = 现有库真实口令，库内口令未改动）" >&2
  else
    echo "::error::preflight: 读回的口令无法连通 $PG_DB，拒绝写入 .env（宁可不部署也不写错值）" >&2
    echo "::error::preflight: 写错值不会立刻失败，而是在 30 分钟健康轮询后才超时，极难排查。" >&2
    echo "::error::preflight: 请手动确认库内真实口令：" >&2
    echo "::error::preflight:   cd $APP_DIR && echo 'POSTGRES_PASSWORD=<真实口令>' >> .env" >&2
    exit 1
  fi
fi

# ── 2) compose 预解析 ──────────────────────────────────────────────────
# 输出重定向到 /dev/null：`docker compose config` 会展开全部 environment（含口令），
# 不能进 CI 日志。仅 stderr 落临时文件，失败时回显（compose 的报错不含变量值）。
if docker compose config >/dev/null 2>/tmp/preflight-compose.err; then
  echo "==> preflight: docker compose config 通过" >&2
else
  echo "::error::preflight: docker compose config 失败（变量仍缺或 YAML 有误），stderr：" >&2
  cat /tmp/preflight-compose.err >&2 || true
  exit 1
fi

echo "==> preflight: OK，可以继续部署" >&2
