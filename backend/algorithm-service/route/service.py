"""
route/service.py — 路网图进程内缓存（构图编排）

进程内单例 + 版本戳失效（专项8 指标 7.3）：
- 每次取图先查版本戳（一条聚合 SQL，毫秒级）——roads 表重灌/口径修正后，
  下一次查询自动触发重建，缓存命中结果 == 清缓存重算结果；
- 构图失败（如 PG 不可达）不抛出冒泡——降级为 None 并告警，flood 域不受牵连；
  调用方（T5.3 路由层）将 None 映射为 503 可操作错误。
"""

from __future__ import annotations

import logging
import threading
import time

from . import source
from .graph import RoadGraph
from .topology import split_at_endpoints

_logger = logging.getLogger("algorithm-service")

_lock = threading.Lock()
_cached: RoadGraph | None = None
_cached_stamp: str | None = None


def _build_graph() -> RoadGraph:
    """构图流水线：读线 → 端点投影切分（建拓扑）→ 网格吸附构图"""
    roads = source.fetch_roads()
    return RoadGraph(split_at_endpoints(roads))


def get_road_graph() -> RoadGraph | None:
    """取路网图（带版本戳失效）；构图失败返回 None（调用方转 503），不抛异常。"""
    global _cached, _cached_stamp
    try:
        stamp = source.fetch_version_stamp()
    except Exception as exc:  # noqa: BLE001 —— PG 不可达时沿用旧图/返回 None，见模块注释
        if _cached is not None:
            _logger.warning("版本戳查询失败，沿用既有路网图：%s", exc)
            return _cached
        _logger.error("路网版本戳查询失败且无可用缓存（PG 就绪？）：%s", exc)
        return None

    with _lock:
        if _cached is not None and stamp == _cached_stamp:
            return _cached
        t0 = time.time()
        graph = _build_graph()
        _logger.info(
            "路网图%s：戳=%s，耗时 %.1fs（构图统计见构建日志）",
            "重建" if _cached is not None else "构建",
            stamp,
            time.time() - t0,
        )
        _cached, _cached_stamp = graph, stamp
        return _cached


def warmup() -> None:
    """启动预热：应用 lifespan 调用，失败仅告警不阻断启动（flood 域可用性优先）。"""
    t0 = time.time()
    graph = get_road_graph()
    if graph is None:
        _logger.warning("路网图启动预热失败——路径查询将返回 503，flood 域不受影响")
        return
    _logger.info("路网图预热完成，耗时 %.1fs：%s", time.time() - t0, graph.stats)
