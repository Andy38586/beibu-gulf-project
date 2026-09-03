"""
route/graph.py — 路网图构建与路径查询（纯计算，不触 IO）

数据流：roads 表 → source.fetch_roads() 取边 → RoadGraph 构图 → find_path 查询。
本模块不 import 数据库驱动，构图与查询的全部行为可离线单测。

设计契约（对应专项8 第七部分，构图的"应然"标尺）：
- 权重口径（7.1）：距离（米）与时长（分）是两条独立边属性，由同一条边各自推导，
  绝不互相派生；mode 只决定"按哪条权重寻路"，结果里两口径同时返回（同源不混算）。
- 断链语义（7.2）：起终点吸附不上路网、或两节点不可达，均返回合法空结果
  （found=False + 显式 reason），绝不抛异常冒泡成 500；孤岛规模进构图统计，不静默吞。
- 确定性（7.4）：节点吸附与平行边胜者都有显式平局规则；构图顺序由输入边顺序决定
  （source 层 ORDER BY id），重建图与原图逐节点逐边一致 → 同 OD 同结果。
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from typing import Iterable, NamedTuple

import networkx as nx

_logger = logging.getLogger("algorithm-service")

# 路网边（roads 表一行经端点展开后的最小表示）
class Edge(NamedTuple):
    edge_id: int
    road_class: str | None
    length_m: float
    from_lng: float
    from_lat: float
    to_lng: float
    to_lat: float


# 吸附网格尺寸（米）：同一网格内的端点合并为同一节点（OSM 端点浮点噪声/米级偏差消除）。
# 节点坐标偏差 ≤ 格对角（~85m），路径里程在该量级内近似；起终点吸附半径同取此值。
SNAP_CELL_M = 60.0  # 米

# 网格步长的经度换算参考纬度：北部湾业务域中心（域内 18-25°N，cos 误差 <7%），
# 只影响格宽不影响正确性——吸附最终按精确距离过滤（宁大勿漏 + 过滤收口，02 §5.6.3）
REFERENCE_LAT = 21.8

# class 限速表（km/h）：OSM highway 分类的中国大陆一般路段经验值（maxspeed 列源数据
# 全 NULL，time 口径以本表为唯一出处）；新增 class 只改此处。未列出的走 DEFAULT 并计数。
CLASS_SPEED_KMH: dict[str, int] = {
    "motorway": 100,
    "motorway_link": 60,
    "trunk": 80,
    "trunk_link": 50,
    "primary": 60,
    "primary_link": 40,
    "secondary": 50,
    "secondary_link": 30,
    "tertiary": 40,
    "tertiary_link": 30,
    "residential": 30,
    "service": 20,
    "unclassified": 30,
    "road": 30,
    "living_street": 20,
}
DEFAULT_SPEED_KMH = 30  # 未知 class 兜底限速；使用即计入 unknown_classes，不静默

# 不可通行分类（驾车口径，第一性原理：路径服务回答的是机动车从 A 到 B）：
# - construction/proposed：未建成道路，参与寻路会产生"穿越工地"的假路径；
# - pedestrian/platform/corridor/elevator/escape/ladder/steps 类：步行设施；
# - bus_stop/busway：公交站台与 BRT 专用道，社会车辆禁行；
# - raceway/rest_area/services/disused/passing_place/no：赛道/服务区内部/废弃/无语义。
# 排除即计数入构图统计（不静默吞），class 演进只改此处
EXCLUDED_CLASSES = frozenset(
    {
        "construction",
        "proposed",
        "pedestrian",
        "platform",
        "corridor",
        "elevator",
        "escape",
        "ladder",
        "bus_stop",
        "busway",
        "raceway",
        "rest_area",
        "services",
        "disused",
        "passing_place",
        "no",
    }
)

# mode → 寻路权重属性（两口径字段分离，7.1）
MODE_WEIGHT = {"distance": "weight_m", "time": "weight_min"}


def _cell_of(lng: float, lat: float, step_lng: float, step_lat: float) -> tuple[int, int]:
    return (math.floor(lng / step_lng), math.floor(lat / step_lat))


def _approx_dist_m(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    """等距圆柱近似（equirectangular）距离（米）：吸附尺度（≤百米）下与大地线差异可忽略"""
    lat_mid = math.radians((lat1 + lat2) / 2)
    dx = (lng2 - lng1) * 111_320.0 * math.cos(lat_mid)
    dy = (lat2 - lat1) * 110_540.0
    return math.hypot(dx, dy)


class RoadGraph:
    """路网图：网格吸附构图 + 双口径权重 + 路径查询。"""

    def __init__(self, edges: Iterable[Edge]) -> None:
        step_lng = SNAP_CELL_M / (111_320.0 * math.cos(math.radians(REFERENCE_LAT)))
        step_lat = SNAP_CELL_M / 110_540.0

        self._step = (step_lng, step_lat)
        # 节点键 = 吸附格键；节点坐标 = 格内首见端点（输入边序确定 → 吸附结果确定，7.4）
        self._node_coord: dict[tuple[int, int], tuple[float, float]] = {}

        # 平行边（同节点对多条 OSM 边）按 (length_m, edge_id) 取最小——距离最短者为胜者，
        # 其时长由该边自身限速推导（两口径同源，禁止"距离取 A 边、时长取 B 边"混配，7.1）
        best_edge: dict[tuple[int, int], Edge] = {}
        excluded: Counter[str] = Counter()
        unknown_classes: set[str] = set()

        for e in edges:
            if e.road_class in EXCLUDED_CLASSES:
                excluded[f"class_{e.road_class}"] += 1
                continue
            if e.length_m is None or e.length_m <= 0:
                excluded["bad_length"] += 1
                continue
            if e.road_class not in CLASS_SPEED_KMH:
                unknown_classes.add(e.road_class or "<null>")

            u_cell = _cell_of(e.from_lng, e.from_lat, step_lng, step_lat)
            v_cell = _cell_of(e.to_lng, e.to_lat, step_lng, step_lat)
            u = self._node_coord.setdefault(u_cell, (e.from_lng, e.from_lat))
            v = self._node_coord.setdefault(v_cell, (e.to_lng, e.to_lat))

            if u_cell == v_cell:
                # 两端同格（<格宽的短边）已合并为同一节点：连通性由相邻边保持，自环无图意义
                excluded["self_loop"] += 1
                continue

            key = (u_cell, v_cell) if u_cell <= v_cell else (v_cell, u_cell)
            prev = best_edge.get(key)
            if prev is None or (e.length_m, e.edge_id) < (prev.length_m, prev.edge_id):
                best_edge[key] = e

        graph = nx.Graph()
        for (u_cell, v_cell), e in best_edge.items():
            # 时长（分）= 距离（km）÷ 限速（km/h）× 60——分子必须先除 1000 折算千米，
            # 否则把米当千米时长放大 1000 倍（专项8 7.1 权重单位 P0 语义，单测已固化）
            speed = CLASS_SPEED_KMH.get(e.road_class or "", DEFAULT_SPEED_KMH)
            graph.add_edge(
                u_cell,
                v_cell,
                weight_m=round(e.length_m, 2),
                weight_min=round(e.length_m / 1000.0 / speed * 60.0, 4),
                edge_id=e.edge_id,
            )

        self.graph = graph
        self.unknown_classes = sorted(unknown_classes)

        # 孤岛统计（7.2：孤岛不静默吞）——无向分量数与最大分量占比入构图日志
        n_edges = graph.number_of_edges()
        components = list(nx.connected_components(graph))
        largest = max(components, key=len) if components else set()
        largest_edges = graph.subgraph(largest).number_of_edges() if largest else 0
        self.stats = {
            "nodes": graph.number_of_nodes(),
            "edges": n_edges,
            "components": len(components),
            "largest_component_edge_ratio": round(largest_edges / n_edges, 4) if n_edges else 0.0,
            "excluded": dict(excluded),
            "unknown_classes": self.unknown_classes,
        }
        _logger.info("路网图构建：%s", self.stats)

    # ---- 查询 ----

    def _nearest_node(self, lng: float, lat: float) -> tuple[int, int] | None:
        """吸附最近节点：5x5 邻域粗筛（宁大勿漏）+ 精确距离 ≤ 吸附半径收口。

        覆盖性论证：候选节点实际距离 ≤ SNAP_CELL_M = 格宽，则其格必与目标格相邻
        或相同，必落在 5x5 邻域内 → 粗筛不丢候选（02 §5.6.3）。
        平局规则（7.4）：距离相等取格键字典序最小。
        """
        cx, cy = _cell_of(lng, lat, *self._step)
        best: tuple[int, int] | None = None
        best_d2 = SNAP_CELL_M**2
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                node = (cx + dx, cy + dy)
                if node not in self._node_coord:
                    continue
                coord = self._node_coord[node]
                d = _approx_dist_m(lng, lat, coord[0], coord[1])
                if d > SNAP_CELL_M:
                    continue
                d2 = d * d
                if d2 < best_d2 - 1e-9 or (
                    d2 <= best_d2 + 1e-9 and (best is None or node < best)
                ):
                    best, best_d2 = node, d2
        return best

    def find_path(
        self,
        from_lng: float,
        from_lat: float,
        to_lng: float,
        to_lat: float,
        mode: str = "distance",
    ) -> dict:
        """路径查询。不可达/未吸附返回合法空结果（found=False + reason），不抛异常（7.2）。"""
        if mode not in MODE_WEIGHT:
            raise ValueError(f"mode 必须为 {' / '.join(MODE_WEIGHT)}，收到：{mode}")
        weight_attr = MODE_WEIGHT[mode]

        u = self._nearest_node(from_lng, from_lat)
        if u is None:
            return {"found": False, "reason": "origin_not_snapped"}
        v = self._nearest_node(to_lng, to_lat)
        if v is None:
            return {"found": False, "reason": "destination_not_snapped"}

        try:
            path = nx.shortest_path(self.graph, u, v, weight=weight_attr)
        except nx.NetworkXNoPath:
            return {"found": False, "reason": "unreachable"}

        distance_m = 0.0
        duration_min = 0.0
        for a, b in zip(path, path[1:]):
            edge = self.graph.edges[a, b]
            distance_m += edge["weight_m"]
            duration_min += edge["weight_min"]

        coords = [list(self._node_coord[n]) for n in path]
        origin = self._node_coord[u]
        dest = self._node_coord[v]
        return {
            "found": True,
            "mode": mode,
            "distanceM": round(distance_m, 1),
            "durationMin": round(duration_min, 1),
            "snapDistanceM": {
                # 起终点直线接入段不计入里程（诚实口径：里程=路网边累计），单独透出供前端展示
                "from": round(_approx_dist_m(from_lng, from_lat, origin[0], origin[1]), 1),
                "to": round(_approx_dist_m(to_lng, to_lat, dest[0], dest[1]), 1),
            },
            "edgeCount": len(path) - 1,
            "coordinates": coords,
        }
