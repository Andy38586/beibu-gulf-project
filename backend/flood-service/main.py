"""
main.py — 北部湾洪涝在线演算服务（路线 B ④）

FastAPI 微服务：任意水位 → 连通性淹没 GeoJSON（EPSG:4326）。
滑块无极调节的后端：每次请求实时演算（降采样 4x，~1s），
配合 level 档位缓存避免高频拖动打爆。

2026-08-06（用户拍板）：离线预计算档位表（backend/data/flood/flood_levels.json，
0.1m 步长 251 档，precompute_levels.py 多进程生成）→ /api/flood/online 查表秒回
（<10ms），消灭滑块拖动时的在线演算延迟；查表 miss（表缺失/越界档）回退 LRU
动态演算兜底。数据文件化读取（JSON 文件），不写死在代码里。

启动：
  cd backend/flood-service
  .venv/Scripts/python.exe -m uvicorn main:app --port 8000

接口：
  GET /api/flood/online?level=3.5   → {level, featureCount, floodedKm2, features}
  GET /health
"""

from __future__ import annotations

import json
import threading
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from flood_engine import run_online_flood


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 预热预计算档位表（gzip 解压 + JSON 解析 ~1.5s）——避免首次请求卡顿
    _load_levels()
    yield


app = FastAPI(
    title="北部湾洪涝在线演算服务",
    description="连通性淹没（海面种子）实时演算，输入水位（米）输出 4326 GeoJSON",
    version="0.2.0",
    lifespan=lifespan,
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
# 必须用 OrderedDict——move_to_end/popitem(last=False) 是其方法；
# 普通 dict 无 move_to_end，命中缓存即 AttributeError 500（2026-08-06 实锤修复）
_cache_lock = threading.Lock()
_cached_level: OrderedDict[float, dict] = OrderedDict()

# 预计算档位表（0.1m 步长，backend/data/flood/flood_levels.json.gz，precompute_levels.py 产出）
# 与 floodArea.json 同目录——数据文件化，遵循"像原来一样"的数据资产约定；
# gzip 压缩存储（GeoJSON 数字字符串压缩率高，95MB → ~15MB）。
LEVELS_FILE = Path(__file__).resolve().parents[1] / "data" / "flood" / "flood_levels.json.gz"
_levels_cache: dict[str, dict] | None = None


def _load_levels() -> dict[str, dict]:
    """懒加载预计算档位表（进程内只读一次；文件缺失/损坏降级为空表 → 走演算兜底）。"""
    global _levels_cache
    if _levels_cache is None:
        try:
            import gzip

            with gzip.open(LEVELS_FILE, "rt", encoding="utf-8") as f:
                _levels_cache = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            _levels_cache = {}
    return _levels_cache


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

    # ① 预计算档位表查表（0.1m 档，与滑块 step 对齐）——命中秒回，零演算
    pre = _load_levels().get(str(key))
    if pre is not None:
        resp = dict(pre)
        # 回显实际档位（滑块 step=0.1 → key == level，前端无"档位偏差"提示噪音）
        resp["level"] = key
        return resp

    # ② LRU 动态演算缓存（查表 miss 的档位，如档位表缺失/越界）
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
