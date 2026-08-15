#!/usr/bin/env bash
# d064 (D-8=A): 回滚脚本
# 用法: ./scripts/rollback.sh <上一版本tag>
# 例:   ./scripts/rollback.sh 20260802-1
#
# 回滚 = 拉取上一版本镜像 → 切换 compose 环境变量 IMAGE_TAG → 重启服务。
# 要求：部署时已通过 IMAGE_TAG 给镜像打过版本 tag（见 docker-compose.yml）。
set -euo pipefail

PREV_TAG="${1:?用法: ./scripts/rollback.sh <上一版本tag>}"

echo "[rollback] 回滚到镜像版本: beibu-gulf-webgis:${PREV_TAG}"
# --pull missing：回滚目标是本地已有的历史 tag 镜像（CI 部署已打版本 tag），
# 无需也不应依赖远端 registry（无 registry 时 --pull always 会因拉取失败中止回滚）
IMAGE_TAG="$PREV_TAG" docker compose up -d --pull missing

echo "[rollback] 完成。可访问 /api/health/ready 确认服务恢复 (status: ready)。"
