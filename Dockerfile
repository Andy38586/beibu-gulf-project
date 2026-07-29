# ============ Stage 1: Build Frontend ============
# 注意：本仓库为 monorepo，依赖与 build 脚本在根 package.json（无 frontend/package.json）。
# 前端构建由根脚本 `npm run build`（= cd frontend && vite build）触发，产物输出到 frontend/dist。
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# 根依赖锁文件（根 package-lock.json 存在）
COPY package*.json ./
RUN npm ci

# 前端源码与 vite 配置
COPY frontend/ ./frontend/

# 触发 vite build → frontend/dist
RUN npm run build

# ============ Stage 2: Build Backend ============
FROM node:22-alpine AS backend-builder

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --production
COPY backend/ ./

# ============ Stage 3: Production ============
FROM node:22-alpine AS production

WORKDIR /app

# 安装 nginx（提供前端静态资源 + API 反向代理）
RUN apk add --no-cache nginx

# 后端运行时依赖与源码
COPY --from=backend-builder /app/backend ./backend

# 前端构建产物
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# nginx 站点配置（alpine 默认 include /etc/nginx/http.d/*.conf）
COPY nginx.conf /etc/nginx/http.d/default.conf

# 启动脚本（同时拉起后端 + nginx）
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 80 3000

CMD ["/app/docker-entrypoint.sh"]
