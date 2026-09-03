"""
flood.py — 洪涝淹没兼容区（algorithm-service 路由域之一）

由 backend/flood-service/main.py 平移演进：保留 /api/flood/online 与
/api/flood/impact 两条兼容路由与既有语义（档位表查表秒回 + LRU 演算兜底，
垂直基准换算、上取档、空水位直接回空等），保证老链路功能零变化。

本模块只承载 flood 域逻辑；应用装配（日志/CORS/lifespan/health）在 main.py。
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path

from fastapi import APIRouter, Query

from flood_engine import compute_impact, datum_offset, run_online_flood

router = APIRouter()
_logger = logging.getLogger("algorithm-service")

# 档位缓存：水位取整到 0.1m，最近 64 档 LRU（滑块拖动时重复档位秒回）
# 必须用 OrderedDict——move_to_end/popitem(last=False) 是其方法；
# 普通 dict 无 move_to_end，命中缓存即 AttributeError 500（历史实锤）
_cache_lock = threading.Lock()
_cached_level: OrderedDict[float, dict] = OrderedDict()

# 预计算档位表（0.1m 步长，backend/data/flood/flood_levels.json.gz，precompute_levels.py 产出）
# 与 floodArea.json 同目录——数据文件化，遵循数据资产约定；
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


# 设施影响评估数据（backend/data/flood/facilityPoints.json——25 个 curated 港口设施，
# 含 elevation/value/damageRate；空间筛选见 flood_engine.compute_impact）
FACILITIES_FILE = (
    Path(__file__).resolve().parents[1] / "data" / "flood" / "facilityPoints.json"
)
_facilities_cache: list[dict] | None = None


def _load_facilities() -> list[dict]:
    """懒加载设施清单（进程内只读一次；缺失/损坏降级为空列表 → 影响评估返回空）。"""
    global _facilities_cache
    if _facilities_cache is None:
        try:
            _facilities_cache = json.loads(
                FACILITIES_FILE.read_text(encoding="utf-8")
            ).get("facilities", [])
        except (FileNotFoundError, json.JSONDecodeError, AttributeError):
            _facilities_cache = []
    return _facilities_cache


def _engine_module():
    # 首请求触发 DEM 模块级加载（一次 ~1s），后续演算只算 mask/label/shapes；
    # load_dem 自身有模块级 _dem_cache 幂等（flood_engine.py），此处不再叠加 lru_cache
    import flood_engine

    flood_engine.load_dem()
    return flood_engine


def _level_key(water_level: float) -> float:
    """0.1m 档位键归一：向上取档。

    对齐「宁可高估风险不可低估」安全语义——四舍五入会把 2.53 归到 2.5 低估档；
    ceil 取更高一档，与 api 模式 find(档 >= level) 同向。
    water_level*10 减 1e-9 抵消浮点噪声（2.5*10 == 25.000000000000004 不至跳档）。
    """
    return math.ceil(water_level * 10 - 1e-9) / 10


@router.get("/api/flood/online")
def flood_online(
    waterLevel: float = Query(..., ge=-1, le=25, description="水位（米，理论深度基准面，滑块 0~15m；内部换算 EGM96 后查表/演算；参数名统一 waterLevel）"),
):
    # 垂直基准统一：档位表键与 DEM 均为 EGM96 口径（产物按 dem<=level演算生成，
    # 无需重生成），前端水位为理论深度基准面 → 查表/演算前先换算。
    # 换算放在 online 入口而非 run_online_flood：precompute_levels.py 以 EGM96 水位
    # 调引擎生成产物，引擎内部换算会双重扣减。
    offset = datum_offset()
    key = _level_key(waterLevel - offset)
    # 回显理论基准档位：前端 _riskLevelFromFlood / actualWaterLevel 与 api 模式同口径
    echo_level = round(key + offset, 1)

    # EGM96 键 < 0（理论水位低于平均海平面）：档位表自 0 起、物理无淹没，直接回空，
    # 不触发 DEM 加载（filled_utm48n_cut.tif 缺失时也不致 500）
    if key < 0:
        return {"level": echo_level, "featureCount": 0, "floodedKm2": 0.0, "features": []}

    # ① 预计算档位表查表（0.1m 档，与滑块 step 对齐）——命中秒回，零演算
    pre = _load_levels().get(str(key))
    if pre is not None:
        resp = dict(pre)
        # 回显理论基准档位（滑块 step=0.1 → 无"档位偏差"提示噪音）
        resp["level"] = echo_level
        return resp

    # ② LRU 动态演算缓存（查表 miss 的档位，如档位表缺失/越界）
    with _cache_lock:
        hit = _cached_level.get(key)
        if hit is not None:
            # 访问刷新顺序 → 真 LRU（Python 3.8+ dict 保插入序）
            _cached_level.move_to_end(key)
            return hit
    t0 = time.time()
    try:
        _engine_module()  # 预热 DEM 加载（缺失时此处抛异常，被守卫转 503）
        result = run_online_flood(key)
    except Exception as exc:  # noqa: BLE001 —— 兜底路径降级守卫，见下
        # cut 版 DEM（filled_utm48n_cut.tif，gitignored）缺失时兜底演算抛
        # FileNotFoundError 裸 500——改为 503 + 可操作信息（查表路径不受影响）。
        _logger.error("online 兜底演算失败（DEM 缺失？复原见 tools/dem-pipeline/06）：%s", exc)
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=503,
            content={
                "detail": "在线演算不可用：DEM 未就绪（backend/data/flood/dem/filled_utm48n_cut.tif 缺失），"
                "复原脚本见 tools/dem-pipeline/06-restore-cut-dem.ps1；查表档位不受影响",
            },
        )
    result["level"] = echo_level
    result["elapsedMs"] = round((time.time() - t0) * 1000)
    with _cache_lock:
        # 满 64 档时淘汰最久未访问的条目（popitem(last=False) 移除最旧），
        # 取代原 clear() 全清——滑块跨 64 档时不再周期性全量 miss
        if len(_cached_level) >= 64:
            _cached_level.popitem(last=False)
        _cached_level[key] = result
    return result


@router.get("/api/flood/impact")
def flood_impact(
    waterLevel: float = Query(..., ge=-1, le=25, description="水位（米，理论深度基准面；内部换算 EGM96 后查表；参数名统一 waterLevel）"),
):
    """
    设施影响评估：预计算档位表的淹没多边形 ∩ 设施点（空间筛选）→ 受影响设施 + 总损失。

    与 /api/flood/online 共用档位表——滑块拖动时两个请求都查表秒回，零演算。
    """
    # 垂直基准统一（与 flood_online 同口径）：查表键换算 EGM96
    offset = datum_offset()
    key = _level_key(waterLevel - offset)
    echo_level = round(key + offset, 1)
    pre = _load_levels().get(str(key))
    features = pre.get("features", []) if pre else []
    if not features:
        return {"level": echo_level, "affectedFacilities": [], "totalLoss": 0}
    return compute_impact(echo_level, features, _load_facilities())