# 在线演算服务（FastAPI + scipy 连通性淹没，由 flood-service 平移演进）
# 与主容器同 docker network：nginx 经服务名 algorithm-service:8000 反代 /flood-online/
# 数据：backend/data 以 ro volume 挂载（与主容器共享同一份 flood_levels.json.gz /
# facilityPoints.json / dem）——flood.py 数据路径按 parents[1] 推断 /app/backend/data
FROM python:3.12-slim

WORKDIR /app/backend/algorithm-service

# rasterio/scipy 的 manylinux wheel 动态链接系统库，slim 镜像缺失——
# libexpat1（rasterio XML 解析）/ libgomp1（scipy OpenMP），缺失即 ImportError 崩溃循环
RUN apt-get update \
  && apt-get install -y --no-install-recommends libexpat1 libgomp1 \
  && rm -rf /var/lib/apt/lists/*

# 依赖（numpy/scipy/rasterio/shapely 均走 manylinux 轮子，无需系统 GDAL）
# PIP_INDEX_URL 默认阿里云镜像——服务器为国内环境，官方 PyPI 慢/不稳；
# 可用构建参数覆盖（--build-arg PIP_INDEX_URL=官方源）
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ENV PIP_INDEX_URL=$PIP_INDEX_URL
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 服务代码（main.py + flood.py + route/ + flood_engine.py；precompute_levels.py
# 仅离线预计算用，不进镜像）
COPY main.py flood.py flood_engine.py ./
COPY route/ ./route/

# 非 root 运行（与主容器 nodeapp 对齐）——数据卷 ro 挂载只读，无需写权限
RUN useradd --create-home --uid 1000 algo \
  && mkdir -p /app/backend/algorithm-service/logs \
  && chown -R algo:algo /app/backend/algorithm-service
USER algo

EXPOSE 8000

# HEALTHCHECK（main.py /health 已有；docker-compose 编排可探活）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1

# 单 worker：预计算表查表为主（251 档 0~25m 全覆盖），演算仅在查表 miss 时触发，
# 串行演算避免多 worker 重复加载 DEM 放大内存（服务器 1.6Gi 小内存）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]