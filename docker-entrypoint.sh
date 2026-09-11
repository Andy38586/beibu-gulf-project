#!/bin/sh
# 北部湾港 WebGIS 容器启动脚本
# 职责：条件生成 HTTPS 配置 → 启动后端 + nginx → 优雅关停

# === 1. 条件生成 HTTPS 配置（证书存在时才启用 443） ===
if [ -f /etc/nginx/certs/fullchain.pem ] && [ -f /etc/nginx/certs/privkey.pem ]; then
  cat > /etc/nginx/http.d/https.conf <<'EOF'
server {
    listen 443 ssl;
    # 2026-08-10：8443 备用 HTTPS 端口——beibu-gulf.duckdns.org 的 SNI 在
    # 部分宽带网络被干扰（443 握手 reset），8443 通常不在 SNI 检测范围
    listen 8443 ssl;
    server_name localhost;
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:2m;
    ssl_session_timeout 10m;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    # CSP（2026-09-10 补）：此前只存在于 nginx.conf 的 :80 server 块，而真实流量走本
    # 443/8443 server（由本 heredoc 生成），导致 CSP 对生产流量完全不生效。
    # 沿用 :80 的 Report-Only 口径（Cesium/Turf 仍需 unsafe-eval，强制策略会打断 3D），
    # 先收窄再收紧。⚠️ 与 nginx.conf:34 必须同步修改（两份配置手抄，是历史分叉点）。
    add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;

    # ⚠️⚠️ 安全头继承陷阱（2026-09-11 实测修复）——本文件下方每个自带 add_header 的
    # location 都必须把这 4 个头重复一遍，原因：
    #   nginx 的 add_header 是**层级全量替换**语义——子级只要出现任意一条 add_header，
    #   父级（server 块）的所有 add_header **全部不再继承**，不是合并。
    # 后果（线上 112.74.32.206 实测证据）：
    #   GET /                      → 200，4 个安全头齐全 ✅
    #   GET /nest-api/             → 404，4 个安全头齐全 ✅（无自带 add_header）
    #   GET /assets/js/index-*.js  → 200，**4 个全丢** ❌ ← 首屏必加载的 JS
    #   GET /tianditu/             → 404，HSTS/CSP 丢失 ❌
    # 即「我给 HTTPS 加了 CSP/HSTS」这句话，在 /assets/、/data/、/static/、/cesium/、
    # /tianditu/ 这些**真实资源路径**上都不成立——注意这正是「做了但没生效」的又一变体，
    # 与 Cesium SSE 挂错宿主同族：语法合法、配置看着合理、无任何报错，只有实测响应头才看得见。
    # 修复方式：把 server 级 4 个头**逐字重复**到每个自带 add_header 的 location 中。
    # ⚠️ 修改此处时，下面的 location 副本必须同步（否则新头又只在部分路径生效）。

    location / {
        root /app/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    location /nest-api/ {
        proxy_pass http://nest:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /api/ {
        rewrite ^/api(/.*)$ /nest-api$1 break;
        proxy_pass http://nest:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # 2026-09-10（阶段 4）：原 location /flood-online/（反代 algorithm-service:8000）
    # 已随 FastAPI 退役删除
    location /assets/ {
        root /app/frontend/dist;
        # 2026-09-11 修复重复 Cache-Control：nginx `expires` 指令本身会生成
        # `Cache-Control: max-age=<t>`（ngx_http_headers_module 文档原文：
        # "time is positive or zero — Cache-Control: max-age=t"），
        # 因此 `expires 1y` + `add_header Cache-Control` 会同时下发**两条** Cache-Control，
        # 浏览器行为未定义（实测线上取第一条），手写那条等于无效——`immutable` 从未生效。
        # 修法：二者只留其一。本 location 需要 `immutable`（带 hash 的产物），故删 expires、
        # 改手写真值（max-age 31536000 = 1y），并带 always 保证 304/4xx 也下发。
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        # 安全头重复（add_header 层级替换语义，详见本 server 块顶部说明）
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
    }
    location /data/ {
        root /app/frontend/dist;
        # 2026-09-11：删手写 add_header Cache-Control "public"——expires 已生成 max-age，
        # 手写那条会造成重复头且被遮蔽（详见 /assets/ 处说明）。
        expires 7d;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
    }
    location /static/terrain/ {
        alias /app/backend/static/terrain/;
        # 2026-09-11：删手写 Cache-Control（同 /data/，避免重复头）
        expires 30d;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
        # 2026-08-09：.terrain 瓦片本身是 gzip 压缩流（CTB 输出，后端 Express 也这样
        # Content-Encoding: gzip 响应，Cesium 才能解压 heightmap）；nginx 直发需补该头，
        # 否则 Cesium 按原始字节解析 → RangeError: Invalid typed array length。
        # 2026-08-10 修复：gzip 头只对 .terrain 生效（嵌套 location）——原无条件 add_header
        # 让 layer.json 被声明 gzip 但内容未压缩 → ERR_CONTENT_DECODING_FAILED → 真地形失效
        # 2026-09-11 补：嵌套 location 同样有"层级替换"问题，故安全头也需再重复一层
        location ~ \.terrain$ {
            # 2026-09-11：本嵌套 location 无 expires，但父级 expires 30d **会正常继承**
            # （expires 是独立指令，不受 add_header 层级替换影响）——实测确认父级
            # `Cache-Control: max-age=2592000` 会与本处手写的 `public` 并存 → 又是重复头。
            # 故此处删掉手写 Cache-Control，只保留必须的 Content-Encoding 与安全头。
            add_header Content-Encoding gzip;
            add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
            add_header X-Content-Type-Options "nosniff" always;
            add_header X-Frame-Options "SAMEORIGIN" always;
            add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
        }
    }
    location /static/ {
        alias /app/backend/static/;
        # 2026-09-11：删手写 Cache-Control（同 /data/，避免重复头）
        expires 30d;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
    }
    # z022: 天地图瓦片同源代理（与 nginx.conf 一致，2026-08-09 双份配置对齐；
    # 2026-09-11 补安全头重复）
    location /tianditu/ {
        proxy_pass https://t0.tianditu.gov.cn/;
        proxy_http_version 1.1;
        proxy_set_header Host t0.tianditu.gov.cn;
        proxy_set_header X-Real-IP "";
        proxy_ssl_server_name on;
        # 2026-09-11：删手写 Cache-Control（expires 已生成 max-age，避免重复头）
        expires 30d;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
    }
    location /cesium/ {
        root /app/frontend/dist;
        # 2026-09-11：删手写 Cache-Control（同 /data/，避免重复头）
        expires 30d;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
    }
    gzip on;
    # 2026-09-11：补 image/svg+xml（与 nginx.conf 的 :80 段及下方 brotli 同口径）
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    gzip_min_length 1000;
    # brotli 实时压缩（与 default.conf 同配，https 独立 server 块需重复声明）
    brotli on;
    brotli_comp_level 6;
    brotli_min_length 1000;
    brotli_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
}
EOF
  echo "[entrypoint] TLS 证书已检测，HTTPS (443) 已启用"
else
  # 确保无残留配置（容器复用时）
  rm -f /etc/nginx/http.d/https.conf
  echo "[entrypoint] 未检测到 TLS 证书，仅 HTTP (80) 服务"
fi

# === 2. 启动 nginx ===
# v3 三服务分离后，本容器只承载前端 + nginx 反代；nest（3000）与 algorithm-service（8000）
# 为 compose 独立容器，经服务名互连——此处不再启动内嵌 Express（已退役）
nginx -g 'daemon off;' &
NGINX_PID=$!

# === 3. 优雅关停：转发 SIGTERM/SIGINT 给子进程 ===
shutdown() {
  echo "[entrypoint] 收到关停信号，正在优雅停止..."
  kill -QUIT $NGINX_PID 2>/dev/null
  wait $NGINX_PID 2>/dev/null
  exit 0
}
trap shutdown TERM INT

# 等待任一进程退出
wait -n $NGINX_PID
EXIT_CODE=$?

# 清理
kill $NGINX_PID 2>/dev/null
exit $EXIT_CODE
