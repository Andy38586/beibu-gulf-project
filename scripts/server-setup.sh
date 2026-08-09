#!/usr/bin/env bash
# ============================================================
# 阿里云 Ubuntu 服务器初始化脚本（2026-08-09 部署文档化）
# 用法：bash scripts/server-setup.sh [/opt/beibu-gulf]
# 幂等：Docker/项目目录/.env 已存在则跳过对应步骤
# 前置：服务器 SSH 公钥已加入 GitHub 账户（git pull 免密，"阿里云乌班图"）
# ============================================================
set -euo pipefail

APP_DIR="${1:-/opt/beibu-gulf}"

echo "==> [1/4] 安装 Docker + compose 插件"
if ! command -v docker >/dev/null 2>&1; then
  # 官方源安装（海外服务器）；失败自动 fallback 阿里云镜像源（国内 ECS 官方源被墙）
  if ! curl -fsSL https://get.docker.com -o /tmp/get-docker.sh || ! sudo sh /tmp/get-docker.sh; then
    echo "==> 官方源安装失败，切换阿里云 docker-ce 镜像源"
    sudo rm -f /etc/apt/sources.list.d/docker.list
    sudo mkdir -p /etc/apt/keyrings
    sudo curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg |
      sudo tee /etc/apt/keyrings/docker.asc >/dev/null
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
      sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  fi
fi
# 免 sudo 用 docker（重新登录 SSH 生效）
if ! id -nG | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  echo "==> 已将 $USER 加入 docker 组（重新登录 SSH 生效）"
fi
systemctl enable --now docker || sudo systemctl enable --now docker

echo "==> [2/4] 项目目录 $APP_DIR"
mkdir -p "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone git@github.com:Andy38586/beibu-gulf-project.git "$APP_DIR"
fi
cd "$APP_DIR"

echo "==> [3/4] 环境配置（幂等）"
# compose 构建参数：VITE_TIANDITU_KEY（Dockerfile ARG 消费，见 docker-compose.yml）
if [ ! -f .env ]; then
  read -rsp "请输入天地图新 key（VITE_TIANDITU_KEY）: " TK
  echo
  cat > .env <<EOF
VITE_TIANDITU_KEY=$TK
EOF
  echo "已写入 .env"
fi
# 后端运行时密钥（compose env_file 消费，不烘焙进镜像）
if [ ! -f backend/.env ]; then
  cat > backend/.env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
PORT=3000
NODE_ENV=production
EOF
  echo "已生成 backend/.env（JWT_SECRET 随机）"
fi

echo "==> [4/4] 完成。剩余人工步骤："
echo "  1. 阿里云安全组放行 80（HTTP，无证书）"
echo "  2. 国内服务器建议配置 Docker 镜像加速器（阿里云容器镜像服务→镜像加速器→专属地址，"
echo "     写入 /etc/docker/daemon.json 的 registry-mirrors 并 restart docker，否则拉 node 镜像慢/超时）"
echo "  3. GitHub 仓库 Secrets 新建："
echo "     - SERVER_SSH_KEY = 服务器私钥全文（cat ~/.ssh/id_ed25519）"
echo "     - SERVER_HOST   = 服务器公网 IP"
echo "     - SERVER_USER   = root 或 ubuntu"
echo "     - TIANDITU_KEY  = 天地图新 key（CI 构建用）"
echo "  3. push main 即触发 CI 全绿后 SSH 自动部署"
echo "  4. 验证：curl http://<服务器IP>/ 应返回前端页面"
