"""
main.py — 北部湾在线演算服务（algorithm-service）

FastAPI 微服务：承载项目全部计算算法。由 backend/flood-service 平移演进——
flood 兼容区（flood.py）保留既有 /api/flood/online|impact 路由，route 新区
（route/）为最短路径等算法预留分域，后续算法统一追加于此。

任意水位 → 连通性淹没 GeoJSON（EPSG:4326）；滑块无极调节的后端：
预计算档位表（0.1m 步长 251 档）查表秒回（<10ms），miss 回退 LRU 动态演算。

启动：
  cd backend/algorithm-service
  .venv/Scripts/python.exe -m uvicorn main:app --port 8000

接口：
  GET /api/flood/online?waterLevel=3.5   → {level, featureCount, floodedKm2, features}
  GET /api/flood/impact?waterLevel=3.5   → {level, affectedFacilities, totalLoss}
  GET /health
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from flood import _load_levels
from flood import router as flood_router
from route import router as route_router
from route.service import warmup as route_warmup

# 日志分级 + 按天轮转——原仅 uvicorn stdout（docker 捕获，无轮转），长跑磁盘
# 风险 + 无 error 级独立检索。容器 stdout 仍保留（logger 根 handler 同步输出），
# 文件轮转兜底本地/挂载场景。
_LOG_DIR = Path(os.environ.get("ALGORITHM_SERVICE_LOG_DIR", "")) or (
    Path(__file__).resolve().parent / "logs"
)
_LOG_DIR.mkdir(parents=True, exist_ok=True)
_logger = logging.getLogger("algorithm-service")
_logger.setLevel(logging.INFO)
_fmt = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
_file_handler = logging.handlers.TimedRotatingFileHandler(
    _LOG_DIR / "algorithm-service.log", when="midnight", backupCount=14, encoding="utf-8"
)
_file_handler.setFormatter(_fmt)
_logger.addHandler(_file_handler)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_fmt)
_logger.addHandler(_stream_handler)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 启动预热预计算档位表（gzip 解压 + JSON 解析 ~1.5s）——避免首次请求卡顿
    _load_levels()
    # 路网图后台预热（构图 ~40s，daemon 线程不阻塞服务就绪——flood 域可用性优先）。
    # 线程安全由 route.service 的锁保证；预热完成前路径查询走同一把锁惰性构建。
    # 失败仅告警：PG 未就绪时路径查询返回 503，flood 域不受牵连。
    # ROUTE_WARMUP=0 关闭（测试环境不测路径，见 tests/conftest.py）。
    if os.environ.get("ROUTE_WARMUP", "1") != "0":
        threading.Thread(target=route_warmup, name="route-warmup", daemon=True).start()
    yield


app = FastAPI(
    title="北部湾在线演算服务",
    description="算法服务：连通性淹没（海面种子）实时演算 + 后续最短路径等；输入水位（米）输出 4326 GeoJSON",
    version="0.3.0",
    lifespan=lifespan,
)

# 开发期 CORS：允许 Vite dev（5173）。生产由 nginx 同源反代，无需 CORS。
# methods/headers 收窄到实际使用（GET 查询 + 少量 POST），不再通配
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(flood_router)
app.include_router(route_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "algorithm-online"}