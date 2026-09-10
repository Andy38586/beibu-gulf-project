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
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location /data/ {
        root /app/frontend/dist;
        expires 7d;
        add_header Cache-Control "public";
    }
    location /static/terrain/ {
        alias /app/backend/static/terrain/;
        expires 30d;
        add_header Cache-Control "public";
        # 2026-08-09：.terrain 瓦片本身是 gzip 压缩流（CTB 输出，后端 Express 也这样
        # Content-Encoding: gzip 响应，Cesium 才能解压 heightmap）；nginx 直发需补该头，
        # 否则 Cesium 按原始字节解析 → RangeError: Invalid typed array length。
        # 2026-08-10 修复：gzip 头只对 .terrain 生效（嵌套 location）——原无条件 add_header
        # 让 layer.json 被声明 gzip 但内容未压缩 → ERR_CONTENT_DECODING_FAILED → 真地形失效
        location ~ \.terrain$ {
            add_header Cache-Control "public";
            add_header Content-Encoding gzip;
        }
    }
    location /static/ {
        alias /app/backend/static/;
        expires 30d;
        add_header Cache-Control "public";
    }
    # z022: 天地图瓦片同源代理（与 nginx.conf 一致，2026-08-09 双份配置对齐）
    location /tianditu/ {
        proxy_pass https://t0.tianditu.gov.cn/;
        proxy_http_version 1.1;
        proxy_set_header Host t0.tianditu.gov.cn;
        proxy_set_header X-Real-IP "";
        proxy_ssl_server_name on;
        expires 30d;
        add_header Cache-Control "public";
    }
    location /cesium/ {
        root /app/frontend/dist;
        expires 30d;
        add_header Cache-Control "public";
    }
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
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
