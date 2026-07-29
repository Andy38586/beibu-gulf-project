#!/bin/sh
# 启动后端（express，监听 3000）
cd /app/backend && node index.js &
BACKEND_PID=$!

# 启动 nginx（代理前端静态资源 + /api 反向代理）
nginx -g 'daemon off;' &
NGINX_PID=$!

# 等待任一进程退出
wait -n $BACKEND_PID $NGINX_PID
EXIT_CODE=$?

# 清理
kill $BACKEND_PID $NGINX_PID 2>/dev/null
exit $EXIT_CODE
