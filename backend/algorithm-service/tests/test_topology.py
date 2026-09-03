"""
拓扑切分单测（离线 fixture）：T 型连接 / 容差边界 / 段长守卫 / 端部重合。

背景：roads 源数据纵向道路不在路口切断（横路端点接在纵路中部顶点），
只合并首末点的构图抓不到 T 型连接——本模块用端点投影切分补拓扑。
"""

from __future__ import annotations

import pytest
from shapely.geometry import LineString

from route.graph import RoadGraph
from route.topology import RoadLine, split_at_endpoints

_LNG, _LAT = 108.600, 21.950  # 0.001° ≈ 103m（北部湾纬度）


def _line(pts: list[tuple[float, float]]) -> LineString:
    return LineString(pts)


def _artery() -> RoadLine:
    """纵路 A(西) → B(东)，中点 M 在 (108.605, 21.950)"""
    return RoadLine(1, "primary", 1000.0, _line([(_LNG, _LAT), (_LNG + 0.010, _LAT)]))


def test_t_junction_connected():
    """T 型路口：横路端点精确落在纵路中部顶点 → 切分后两路连通"""
    side = RoadLine(2, "primary", 1000.0, _line([(_LNG + 0.005, _LAT + 0.010), (_LNG + 0.005, _LAT)]))
    edges = split_at_endpoints([_artery(), side])

    # 纵路被切成 2 段，横路无切点保持 1 段
    assert len([e for e in edges if e.edge_id == 1]) == 2
    assert len([e for e in edges if e.edge_id == 2]) == 1

    g = RoadGraph(edges)
    c = (_LNG + 0.005, _LAT + 0.010)  # 横路北端
    a = (_LNG, _LAT)  # 纵路西端
    result = g.find_path(c[0], c[1], a[0], a[1], mode="distance")
    assert result["found"] is True
    # C→M(约1.1km) + M→A(约0.5km)，量级守卫
    assert 1.2e3 < result["distanceM"] < 2.2e3


def test_segment_length_conserved():
    """段长守卫：切分后各段分摊长之和 == 原边表长（口径不漂移，7.1）"""
    side = RoadLine(2, "primary", 1000.0, _line([(_LNG + 0.005, _LAT + 0.010), (_LNG + 0.005, _LAT)]))
    edges = split_at_endpoints([_artery(), side])
    artery_total = sum(e.length_m for e in edges if e.edge_id == 1)
    assert artery_total == pytest.approx(1000.0)


def test_near_endpoint_within_tolerance_connected():
    """端点接近但不重合（~10m 抖动）→ 容差内仍连接"""
    side = RoadLine(
        2, "primary", 1000.0, _line([(_LNG + 0.005, _LAT + 0.010), (_LNG + 0.0051, _LAT + 0.0001)])
    )
    g = RoadGraph(split_at_endpoints([_artery(), side]))
    c = (_LNG + 0.005, _LAT + 0.010)
    a = (_LNG, _LAT)
    result = g.find_path(c[0], c[1], a[0], a[1], mode="distance")
    assert result["found"] is True


def test_beyond_tolerance_stays_disconnected():
    """端点距纵路数百米（> 吸附容差）→ 不产生假连接，孤立路段仍是孤岛（7.2）"""
    side = RoadLine(
        2, "primary", 1000.0, _line([(_LNG + 0.005, _LAT + 0.010), (_LNG + 0.005, _LAT + 0.004)])
    )
    g = RoadGraph(split_at_endpoints([_artery(), side]))
    c = (_LNG + 0.005, _LAT + 0.010)
    a = (_LNG, _LAT)
    result = g.find_path(c[0], c[1], a[0], a[1], mode="distance")
    assert result == {"found": False, "reason": "unreachable"}


def test_endpoint_on_end_no_split_needed():
    """端部重合（横路端点 == 纵路端点）：不切分，网格吸附兜住连通"""
    side = RoadLine(2, "primary", 1000.0, _line([(_LNG, _LAT + 0.010), (_LNG, _LAT)]))
    edges = split_at_endpoints([_artery(), side])
    assert len([e for e in edges if e.edge_id == 1]) == 1  # 纵路无切点
    g = RoadGraph(edges)
    c = (_LNG, _LAT + 0.010)
    b = (_LNG + 0.010, _LAT)
    result = g.find_path(c[0], c[1], b[0], b[1], mode="distance")
    assert result["found"] is True


def test_empty_input():
    assert split_at_endpoints([]) == []
