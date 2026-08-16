# ============ Stage 1: Build Frontend ============
# 注意：本仓库为 monorepo，依赖与 build 脚本在根 package.json（无 frontend/package.json）。
# 前端构建由根脚本 `npm run build`（= cd frontend && vite build）触发，产物输出到 frontend/dist。
# 2026-08-09：VITE_TIANDITU_KEY 作为构建参数传入（vite build 打包进产物）。
# CI 由 GitHub Secrets 注入；服务器 docker compose up --build 由 compose 的 build.args 传入
# （见 docker-compose.yml，值读自服务器项目目录 .env）——否则生产底图 404。
FROM node:22-alpine AS frontend-builder

ARG VITE_TIANDITU_KEY=
ENV VITE_TIANDITU_KEY=$VITE_TIANDITU_KEY

# 2026-08-10：数据源为构建期变量（vite build 打包进产物）——生产设 online 走
# FastAPI 连通性演算（预计算表查表秒回）；缺省 api（Express 251 档表兜底）
ARG VITE_DATA_SOURCE=api
ENV VITE_DATA_SOURCE=$VITE_DATA_SOURCE

WORKDIR /app

# 根依赖锁文件（根 package-lock.json 存在）
# 2026-08-09：改回 npm ci——此前失败是 npmmirror 生成的不完整 lock；
# 官方源重建（f0cce63）后 CI 的 npm ci 稳定成功，lock 对 npm ci 完整。
# 2026-08-10：回退 npm install——服务器构建实测 npm ci EUSAGE（lock 缺
# rollup/fsevents 条目，npm 10.9.8 对 lockfileVersion 3 严格校验），
# npm install 宽容模式（缺 optional/peer 条目自动补齐），部署历程记录方案。
COPY package*.json ./
RUN npm install --no-audit --no-fund

# 前端源码与 vite 配置
COPY frontend/ ./frontend/

# 触发 vite build → frontend/dist
RUN npm run build

# ============ Stage 2: Build Backend ============
FROM node:22-alpine AS backend-builder

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --production --no-audit --no-fund
COPY backend/ ./

# ============ Stage 3: Production ============
FROM node:22-alpine AS production

WORKDIR /app

# 强制生产模式；JWT_SECRET/PORT 由 compose 在容器运行期注入，绝不烘焙进镜像
ENV NODE_ENV=production

# d068: 安装 nginx + su-exec。（原 8.2 d061，重编号消除与主清单 d061-trust proxy 冲突）
# su-exec 让后端进程以非 root 用户运行（容器逃逸时无法以 root 获得宿主机权限）；
# nginx 仍由 entrypoint 以 root 拉起（需绑定 80/443）。
# brotli 模块来自 alpine community 仓库（动态匹配基础镜像小版本），提供实时 brotli 压缩
#（副-07；构建时验证：包缺失会 fail 构建，不会带病上线）
RUN apk add --no-cache nginx su-exec \
  && apk add --no-cache \
    --repository "https://dl-cdn.alpinelinux.org/alpine/v$(cut -d. -f1-2 /etc/alpine-release)/community" \
    nginx-mod-http-brotli

# d068: 创建非 root 用户 nodeapp（uid 1000），并预备可写的数据/日志目录
# 2026-08-09 修复：node:22-alpine 镜像自带 uid 1000 的 node 用户（adduser 冲突），
# 先删除再创建；uid 1000 必须保留（与宿主机 volume 挂载的 admin(uid 1000) 权限匹配）。
RUN deluser node \
  && adduser -D -u 1000 nodeapp \
  && mkdir -p /app/backend/data /app/backend/logs \
  && chown -R nodeapp:nodeapp /app/backend/data /app/backend/logs

# 后端运行时依赖与源码
COPY --from=backend-builder /app/backend ./backend

# 前端构建产物
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# nginx 站点配置（alpine 默认 include /etc/nginx/http.d/*.conf）
COPY nginx.conf /etc/nginx/http.d/default.conf

# 816-专项5主 9：nginx worker 降权（master 保持 root 绑 80/443；worker 以 nodeapp 运行，
# 缩小容器逃逸面）。alpine 主配置若已有 user 指令则替换，否则在 main context 顶部插入。
RUN if grep -q '^user ' /etc/nginx/nginx.conf; then \
      sed -i 's/^user .*/user nodeapp;/' /etc/nginx/nginx.conf; \
    else \
      sed -i '1i user nodeapp;' /etc/nginx/nginx.conf; \
    fi

# 启动脚本（同时拉起后端 + nginx）
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 80 443 3000

# d063: 健康检查探就绪（readiness 查数据目录可读性），编排/负载均衡器据此判定容器可用
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/ready || exit 1

CMD ["/app/docker-entrypoint.sh"]
