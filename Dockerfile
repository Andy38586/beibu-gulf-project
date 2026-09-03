# ============ Stage 1: Build Frontend ============
# 注意：本仓库为 monorepo，依赖与 build 脚本在根 package.json（无 frontend/package.json）。
# 前端构建由根脚本 `npm run build`（= cd frontend && vite build）触发，产物输出到 frontend/dist。
# 2026-08-09：VITE_TIANDITU_KEY 作为构建参数传入（vite build 打包进产物）。
# CI 由 GitHub Secrets 注入；服务器 docker compose up --build 由 compose 的 build.args 传入
# （见 docker-compose.yml，值读自服务器项目目录 .env）——否则生产底图 404。
FROM node:22-alpine AS frontend-builder

ARG VITE_TIANDITU_KEY=
ENV VITE_TIANDITU_KEY=$VITE_TIANDITU_KEY

# 2026-08-10：数据源为构建期变量（vite build 打包进产物）——生产设 fetch（查表）走
# Nest 读文件链路；calculate（实时演算）走 FastAPI；缺省 fetch（Express 退役后语义）
ARG VITE_DATA_SOURCE=fetch
ENV VITE_DATA_SOURCE=$VITE_DATA_SOURCE

# v3：业务后端模块切换开关（构建期变量）——生产默认全六域切 Nest（Express 已退役）；
# 回滚旧版或临时走 Express 时清空此值（compose build.args 覆盖）
ARG VITE_USE_NEST_MODULES=auth,plans,favorites,forecast,flood,site-analysis
ENV VITE_USE_NEST_MODULES=$VITE_USE_NEST_MODULES

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

# ============ Stage 2: Production ============
FROM node:22-alpine AS production

WORKDIR /app

# d068: 安装 nginx（原 su-exec 服务于 Express 进程降权，v3 三服务分离后 app 容器
# 只承载前端 + nginx，不再启动后端进程——nest/algorithm-service/postgis 为独立容器）
# brotli 模块来自 alpine community 仓库（动态匹配基础镜像小版本），提供实时 brotli 压缩
#（副-07；构建时验证：包缺失会 fail 构建，不会带病上线）
RUN apk add --no-cache nginx \
  && apk add --no-cache \
    --repository "https://dl-cdn.alpinelinux.org/alpine/v$(cut -d. -f1-2 /etc/alpine-release)/community" \
    nginx-mod-http-brotli

# 预备 nginx worker 降权用户（816-专项5主 9）与静态数据挂载点
# （v3 起 static 数据由 compose ro volume 挂载，此处仅建立目录供 alias 存在）
RUN adduser -D -H -s /sbin/nologin nodeapp -u 1000 \
  && mkdir -p /app/backend/static/dem /app/backend/static/terrain

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

# 启动脚本（只拉起 nginx；nest / algorithm-service 为 compose 独立服务）
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 80 443

# 健康检查探前端就绪（app 容器不再内嵌 API，编排层以 depends_on nest healthy 联动）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ || exit 1

CMD ["/app/docker-entrypoint.sh"]
