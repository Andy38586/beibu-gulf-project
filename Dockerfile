# ============ Stage 1: Build Frontend ============
# 注意：本仓库为 monorepo，依赖与 build 脚本在根 package.json（无 frontend/package.json）。
# 前端构建由根脚本 `npm run build`（= cd frontend && vite build）触发，产物输出到 frontend/dist。
# 2026-08-09：VITE_TIANDITU_KEY 作为构建参数传入（vite build 打包进产物）。
# CI 由 GitHub Secrets 注入；服务器 docker compose up --build 由 compose 的 build.args 传入
# （见 docker-compose.yml，值读自服务器项目目录 .env）——否则生产底图 404。
FROM node:22-alpine AS frontend-builder

ARG VITE_TIANDITU_KEY=
ENV VITE_TIANDITU_KEY=$VITE_TIANDITU_KEY

# ⚠️ VITE_DATA_SOURCE 已废弃（z156，2026-09-12 清理）：数据源切换代码已随
# algorithm-service 退役删除，不再作为构建期变量下发。

# v3：业务后端模块切换开关（构建期变量）——生产默认全六域切 Nest（Express 已退役）；
# 回滚旧版或临时走 Express 时清空此值（compose build.args 覆盖）
ARG VITE_USE_NEST_MODULES=auth,plans,favorites,forecast,flood,site-analysis
ENV VITE_USE_NEST_MODULES=$VITE_USE_NEST_MODULES

WORKDIR /app

# 根依赖锁文件（根 package-lock.json 存在）
# 2026-08-09：npmmirror 生成的不完整 lock 使 npm ci 报 EUSAGE，曾改回 npm install；
# 2026-08-10：服务器实测 npm ci EUSAGE（lock 缺 rollup/fsevents 条目）再次回退。
# 2026-09-11：lock resolved 全量改指官方源（镜像 tarball 与官方逐条同 integrity），
# 并逐条盘查平台受限可选包——rolldown/lightningcss/napi-rs 的 linux-x64-musl 等
# 均在册（rollup/esbuild 已随 vite 8/rolldown 退出依赖树）。本机以强制平台解析复现
# Alpine 场景：npm ci --dry-run（npm_config_os=linux/cpu=x64/libc=musl）通过、无 EUSAGE。
# 故恢复 npm ci 取得可复现构建；若服务器再现 EUSAGE，回退 npm install（部署历程记录）。
# 2026-09-12（CI build-push 首跑实锤，此前均被前端测试红挡在本步之前）两层补齐：
# ① COPY .npmrc——仓库 .npmrc 含 legacy-peer-deps（rollup-plugin-visualizer 的
#    rollup@2.80.0 peer 在 strict 校验下 EUSAGE）与官方 registry源，不进镜像则
#    npm ci 以默认 strict 校验直接炸；
# ② ENV HUSKY=0——镜像内无 .git（.dockerignore 排除），husky prepare 在无 .git
#    环境非零退出。两者叠加即「本地 npm ci 全绿、docker npm ci exit 1」。
COPY package*.json .npmrc ./
ENV HUSKY=0
RUN npm ci --no-audit --no-fund

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

# 预备 nginx worker 降权用户与静态数据挂载点
# （v3 起 static 数据由 compose ro volume 挂载，此处仅建立目录供 alias 存在）
# node:22-alpine 自带 uid 1000 的 node 用户——直接复用为 nginx worker 账户；
# 此前 adduser -u 1000 新建 nodeapp 与基础镜像 node 用户撞 uid，全新构建必失败
RUN mkdir -p /app/backend/static/dem /app/backend/static/terrain

# 前端构建产物
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# nginx 站点配置（alpine 默认 include /etc/nginx/http.d/*.conf）
COPY nginx.conf /etc/nginx/http.d/default.conf

# nginx worker 降权（master 保持 root 绑 80/443；worker 以内置 node 用户运行，
# 缩小容器逃逸面）。alpine 主配置若已有 user 指令则替换，否则在 main context 顶部插入。
RUN if grep -q '^user ' /etc/nginx/nginx.conf; then \
      sed -i 's/^user .*/user node;/' /etc/nginx/nginx.conf; \
    else \
      sed -i '1i user node;' /etc/nginx/nginx.conf; \
    fi

# 启动脚本（只拉起 nginx；nest / algorithm-service 为 compose 独立服务）
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 80 443

# 健康检查探前端就绪（app 容器不再内嵌 API，编排层以 depends_on nest healthy 联动）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ || exit 1

CMD ["/app/docker-entrypoint.sh"]
