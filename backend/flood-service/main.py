"""
main.py — 北部湾洪涝在线演算服务（路线 B ④）

FastAPI 微服务：任意水位 → 连通性淹没 GeoJSON（EPSG:4326）。
滑块无极调节的后端：每次请求实时演算（降采样 4x，~1s），
配合 level 档位缓存避免高频拖动打爆。

启动：
  cd backend/flood-service
  .venv/Scripts/python.exe -m uvicorn main:app --port 8000

接口：
  GET /api/flood/online?level=3.5   → {level, featureCount, floodedKm2, features}
  GET /health
"""

from __future__ import annotations

import threading
import time
from functools import lru_cache

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from flood_engine import run_online_flood

app = FastAPI(
    title="北部湾洪涝在线演算服务",
    description="连通性淹没（海面种子）实时演算，输入水位（米）输出 4326 GeoJSON",
    version="0.1.0",
)

# 开发期 CORS：允许 Vite dev（5173）。生产由 nginx 同源反代，无需 CORS。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 档位缓存：水位取整到 0.1m，最近 64 档 LRU（滑块拖动时重复档位秒回）
_cache_lock = threading.Lock()
_cached_level: dict[float, dict] = {}


@lru_cache(maxsize=1)
def _engine_module():
    # 首请求触发 DEM 模块级加载（一次 ~1s），后续演算只算 mask/label/shapes
    import flood_engine

    flood_engine.load_dem()
    return flood_engine


@app.get("/api/flood/online")
def flood_online(
    level: float = Query(..., ge=-1, le=25, description="水位（米，DEM 高程基准，滑块 0~20m）"),
):
    key = round(level, 1)
    with _cache_lock:
        hit = _cached_level.get(key)
        if hit is not None:
            # 访问刷新顺序 → 真 LRU（Python 3.8+ dict 保插入序）
            _cached_level.move_to_end(key)
            return hit
    engine = _engine_module()
    t0 = time.time()
    result = run_online_flood(key)
    result["elapsedMs"] = round((time.time() - t0) * 1000)
    with _cache_lock:
        # 满 64 档时淘汰最久未访问的条目（popitem(last=False) 移除最旧），
        # 取代原 clear() 全清——滑块跨 64 档时不再周期性全量 miss（d069）
        if len(_cached_level) >= 64:
            _cached_level.popitem(last=False)
        _cached_level[key] = result
    return result


@app.get("/health")
def health():
    return {"status": "ok", "service": "flood-online"}
