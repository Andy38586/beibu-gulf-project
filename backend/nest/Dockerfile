# v3 业务层后端（NestJS）——Express 退役后的主 API 服务
#
# 与主容器同 docker network：nginx 经服务名 nest:3000 反代 /nest-api/
# 依赖：postgis（v3_dev 库，ROUTE_PG_* / PG_* 注入）、backend/data（ro volume 挂载，
# forecast/flood 静态读文件与 data_archive 语义不变）
#
# 多阶段：builder 编译 TypeScript（devDeps 含 tsc/nest cli）→ runtime 只留产物与 prod 依赖。

# ---------- Stage 1: build ----------
FROM node:22-alpine AS builder

WORKDIR /app/backend/nest

# 先装依赖再用 COPY 源码：依赖层缓存最大化（源码变更不重装 node_modules）
COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig*.json ./
COPY src/ ./src/

# tsconfig 的 outDir 是 dist（nest build 默认）；产物含 JSON 配置（tsconfig.build.json 定义）
RUN npm run build

# ---------- Stage 2: production ----------
FROM node:22-alpine AS production

ENV NODE_ENV=production
WORKDIR /app/backend/nest

# 生产仅需运行时依赖（bcrypt/jsonwebtoken/turf/rbush/pg 等），不装 devDeps
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=builder /app/backend/nest/dist ./dist

# 非 root 运行（对齐 algorithm-service 的 algo / 主容器的 nodeapp）：
# 数据卷 ro 挂载只读；若需写盘（暂无场景）由 compose 显式授权
RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp
USER nodeapp

EXPOSE 3000

# Nest 启动（migrations/seed 由 compose 或部署脚本负责，镜像不内嵌变更）
CMD ["node", "dist/src/main.js"]