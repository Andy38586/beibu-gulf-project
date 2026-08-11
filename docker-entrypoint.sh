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
    location / {
        root /app/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /flood-online/ {
        rewrite ^/flood-online(/.*)$ $1 break;
        # 2026-08-10：独立容器（flood-service），同 docker network 服务名解析
        proxy_pass http://flood-service:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
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

# === 2. 启动后端（express，监听 3000，以非 root 用户 nodeapp 运行，d068） ===
# 数据卷以 root 挂载，启动前降权给 nodeapp 以可写（注册/收藏/标记写盘）
if [ -d /app/backend/data ]; then
  chown -R nodeapp:nodeapp /app/backend/data
fi
cd /app/backend && su-exec nodeapp node index.js &
BACKEND_PID=$!

# === 3. 启动 nginx ===
nginx -g 'daemon off;' &
NGINX_PID=$!

# === 4. 优雅关停：转发 SIGTERM/SIGINT 给子进程 ===
shutdown() {
  echo "[entrypoint] 收到关停信号，正在优雅停止..."
  kill -TERM $BACKEND_PID 2>/dev/null
  kill -QUIT $NGINX_PID 2>/dev/null
  wait $BACKEND_PID $NGINX_PID 2>/dev/null
  exit 0
}
trap shutdown TERM INT

# 等待任一进程退出
wait -n $BACKEND_PID $NGINX_PID
EXIT_CODE=$?

# 清理
kill $BACKEND_PID $NGINX_PID 2>/dev/null
exit $EXIT_CODE
