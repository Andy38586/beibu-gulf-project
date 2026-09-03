"""
路网图单测（离线 fixture，不连 PG）

覆盖专项8 第七部分的四条"应然"标尺：
- 7.1 权重口径：距离（米）/时长（分）字段分离、由同一条边推导，time 模式可选出
  与 distance 模式不同的路径（口径不混算的正面证明）；
- 7.2 断链语义：不可达 → 合法空结果（found=False + reason），未吸附同理，绝不抛异常；
- 7.3（service 层版本戳）与真库相关，离线单测不覆盖——由 probe 对真库人工核验；
- 7.4 确定性：同输入重建图 + 多次查询结果逐字节一致；平行边平局规则显式（短者胜、
  再按 edge_id 小者胜）。
"""

from __future__ import annotations

import math

import pytest

from route.graph import SNAP_CELL_M, REFERENCE_LAT, Edge, RoadGraph

# 与 graph.py 同公式复算网格步长：测试节点按格点摆放，保证落在预期格内
_STEP_LNG = SNAP_CELL_M / (111_320.0 * math.cos(math.radians(REFERENCE_LAT)))
_STEP_LAT = SNAP_CELL_M / 110_540.0
_LNG0, _LAT0 = 108.60, 21.95


def _pt(i: int, j: int) -> tuple[float, float]:
    """第 (i,j) 个格点的坐标（floor(i) 语义下必落在唯一格内）"""
    return (_LNG0 + i * _STEP_LNG, _LAT0 + j * _STEP_LAT)


def _edge(eid: int, cls: str, length_m: float, a: tuple[int, int], b: tuple[int, int]) -> Edge:
    (fx, fy), (tx, ty) = _pt(*a), _pt(*b)
    return Edge(eid, cls, length_m, fx, fy, tx, ty)


def _base_edges() -> list[Edge]:
    """A(0,0)-B(1,0)-C(2,0) 直线主图 + A-D(1,1)-C 高速支线"""
    return [
        _edge(1, "primary", 1000.0, (0, 0), (1, 0)),  # A-B
        _edge(2, "primary", 2000.0, (1, 0), (2, 0)),  # B-C
        _edge(3, "trunk", 1600.0, (0, 0), (1, 1)),  # A-D
        _edge(4, "trunk", 1600.0, (1, 1), (2, 0)),  # D-C
    ]


@pytest.fixture()
def graph() -> RoadGraph:
    return RoadGraph(_base_edges())


def test_distance_mode_primary_route(graph: RoadGraph):
    """distance 模式：选累计里程最短的 primary 直线（3000m），时长由同边限速推导"""
    a, c = _pt(0, 0), _pt(2, 0)
    result = graph.find_path(a[0], a[1], c[0], c[1], mode="distance")
    assert result["found"] is True
    assert result["distanceM"] == pytest.approx(3000.0)
    # 1000m@60km/h = 1min + 2000m@60km/h = 2min → 3min（米/分两口径各自成立，7.1）
    assert result["durationMin"] == pytest.approx(3.0)
    assert result["edgeCount"] == 2


def test_time_mode_selects_faster_highway_route(graph: RoadGraph):
    """time 模式：绕行 trunk 高速支线（3200m 但 2.4min）优于直线（3000m 3min）——
    两口径各自寻路、结果互不混算（7.1 的正面证明）"""
    a, c = _pt(0, 0), _pt(2, 0)
    result = graph.find_path(a[0], a[1], c[0], c[1], mode="time")
    assert result["found"] is True
    assert result["distanceM"] == pytest.approx(3200.0)  # 里程仍以米透出（单位守卫）
    assert result["durationMin"] == pytest.approx(2.4)  # 1600m@80km/h ×2 = 2.4min


def test_unreachable_is_legal_empty_result():
    """断链：孤立子图（远海节点）与主图不可达 → 合法空信封，非异常（7.2）"""
    edges = _base_edges() + [
        _edge(9, "residential", 500.0, (50, 50), (51, 50))  # 远离主图的孤岛
    ]
    g = RoadGraph(edges)
    a, far = _pt(0, 0), _pt(50, 50)
    result = g.find_path(a[0], a[1], far[0], far[1], mode="distance")
    assert result == {"found": False, "reason": "unreachable"}


def test_far_point_not_snapped_returns_empty():
    """起终点吸附不上路网（> 吸附半径）→ 合法空结果并给出可区分原因（7.2）"""
    a, sea = _pt(0, 0), (_LNG0 + 200 * _STEP_LNG, _LAT0 + 200 * _STEP_LAT)
    result = RoadGraph(_base_edges()).find_path(a[0], a[1], sea[0], sea[1], mode="distance")
    assert result == {"found": False, "reason": "destination_not_snapped"}


def test_deterministic_across_rebuild_and_queries():
    """同 OD 同结果：重建图（同输入）与多次查询的坐标序列完全一致（7.4）"""
    a, c = _pt(0, 0), _pt(2, 0)
    first = RoadGraph(_base_edges()).find_path(a[0], a[1], c[0], c[1], mode="time")
    second = RoadGraph(_base_edges()).find_path(a[0], a[1], c[0], c[1], mode="time")
    assert first["coordinates"] == second["coordinates"]
    assert first["distanceM"] == second["distanceM"]
    g = RoadGraph(_base_edges())
    runs = [g.find_path(a[0], a[1], c[0], c[1], mode="time") for _ in range(3)]
    assert all(r == runs[0] for r in runs)


def test_parallel_edge_tie_break():
    """平行边平局：等长时保留 edge_id 更小者（显式规则，7.4）"""
    edges = [
        _edge(7, "primary", 1000.0, (0, 0), (1, 0)),
        _edge(3, "primary", 1000.0, (0, 0), (1, 0)),  # 同节点对、同长度、id 更小
    ]
    g = RoadGraph(edges)
    assert g.graph.number_of_edges() == 1
    (u, v) = next(iter(g.graph.edges))
    assert g.graph.edges[u, v]["edge_id"] == 3


def test_excluded_classes_not_routable():
    """construction 未建成道路不参与寻路，且在统计中显式计数（不静默吞，7.2）"""
    edges = _base_edges() + [_edge(8, "construction", 100.0, (0, 0), (2, 0))]
    g = RoadGraph(edges)
    a, c = _pt(0, 0), _pt(2, 0)
    result = g.find_path(a[0], a[1], c[0], c[1], mode="distance")
    assert result["distanceM"] == pytest.approx(3000.0)  # 未被 100m "工地捷径"吸引
    assert g.stats["excluded"]["class_construction"] == 1


def test_invalid_mode_rejected():
    with pytest.raises(ValueError):
        RoadGraph(_base_edges()).find_path(108.6, 21.95, 108.61, 21.95, mode="km")


def test_stats_record_islands():
    """构图统计含孤岛规模：components/largest_component_edge_ratio 可读（7.2）"""
    stats = RoadGraph(_base_edges()).stats
    assert stats["nodes"] == 4 and stats["edges"] == 4
    assert stats["components"] == 1
    assert stats["largest_component_edge_ratio"] == 1.0
