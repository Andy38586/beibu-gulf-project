"""
route/graph.py — 路网图构建与路径查询（纯计算，不触 IO）

数据流：roads 表 → source.fetch_roads() 取边 → RoadGraph 构图 → find_path 查询。
本模块不 import 数据库驱动，构图与查询的全部行为可离线单测。

设计契约：
- 权重口径：距离（米）与时长（分）是两条独立边属性，由同一条边各自推导，
  绝不互相派生；mode 只决定"按哪条权重寻路"，结果里两口径同时返回（同源不混算）。
- 边级吸附：起终点吸附到最近道路边并按投影比例接入，而非仅吸附路口节点——
  图节点是 60m 吸附格代表点，路口间距可达数百米，"点在路旁几米"的正常地图
  点击在纯节点吸附下会大面积 not_snapped；投影拆边接入是路线服务的通行做法。
- 断链语义：起终点吸附不上路网、或两节点不可达，均返回合法空结果
  （found=False + 显式 reason），绝不抛异常冒泡成 500；孤岛规模进构图统计，不静默吞。
- 确定性：边吸附与平行边胜者都有显式平局规则；构图顺序由输入边顺序决定
  （source 层 ORDER BY id），重建图与原图逐节点逐边一致 → 同 OD 同结果。
- 并发安全：图对象为进程内共享单例，查询期的虚拟节点接入/寻路/摘除在互斥锁
  内完成（毫秒级临界区，不构成吞吐瓶颈）。
"""

from __future__ import annotations

import logging
import math
import threading
from collections import Counter
from typing import Iterable, NamedTuple

import networkx as nx
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.ops import substring

_logger = logging.getLogger("algorithm-service")


# 路网边（roads 表一行经端点展开后的最小表示）。
# coords 为该段完整折线顶点（topology 切分产物）——路径可视化沿真实道路走向
# 必需；缺省回退两端点（直线），供离线测试构造最小边。
class Edge(NamedTuple):
    edge_id: int
    road_class: str | None
    length_m: float
    from_lng: float
    from_lat: float
    to_lng: float
    to_lat: float
    coords: tuple[tuple[float, float], ...] | None = None


# 吸附网格尺寸（米）：同一网格内的端点合并为同一节点（OSM 端点浮点噪声/米级偏差消除）。
SNAP_CELL_M = 60.0

# 网格步长的经度换算参考纬度：北部湾业务域中心（域内 18-25°N，cos 误差 <7%），
# 只影响格宽不影响正确性——吸附最终按精确距离过滤（宁大勿漏 + 过滤收口）
REFERENCE_LAT = 21.8

# 度→米换算因子（等距圆柱近似 + 固定参考纬度，与 topology.py 同口径）：
# 纬向每度实际 110,540m > 本因子（cos 折算），用它换算吸附半径在纬向覆盖偏大，
# 属"宁大勿漏"方向；精确判定仍按该因子的近似距离收口（吸附本就是模糊容差语义）
_DEG_TO_M = 111_320.0 * math.cos(math.radians(REFERENCE_LAT))

# 查询期吸附半径（米）：边级投影吸附容差。地图点击天然带视差错位，用户常点在
# 路侧建筑/空地而非路中心线，构图级的 60m 节点容差对查询不可用；2km 覆盖
# "点到附近任一条路"的常态——海面/无路荒区点击仍诚实 not_snapped，不硬吸远路。
QUERY_SNAP_RADIUS_M = 2000.0

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

# mode → 寻路权重属性（两口径字段分离，互不派生）
MODE_WEIGHT = {"distance": "weight_m", "time": "weight_min"}

# 查询期虚拟节点键：单元组 str 键与 (int,int) 吸附格键永不相撞；仅锁内使用
_ORIGIN_KEY = ("__origin__",)
_DEST_KEY = ("__dest__",)


def _cell_of(lng: float, lat: float, step_lng: float, step_lat: float) -> tuple[int, int]:
    return (math.floor(lng / step_lng), math.floor(lat / step_lat))


def _approx_dist_m(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    """等距圆柱近似（equirectangular）距离（米）：吸附尺度（≤百米）下与大地线差异可忽略"""
    lat_mid = math.radians((lat1 + lat2) / 2)
    dx = (lng2 - lng1) * 111_320.0 * math.cos(lat_mid)
    dy = (lat2 - lat1) * 110_540.0
    return math.hypot(dx, dy)


def _slice_coords(
    line: LineString, a_ratio: float, b_ratio: float
) -> tuple[tuple[float, float], ...]:
    """按比例区间取折线顶点（a→b 方向；a>b 自动反向）。

    虚拟接入段的折线与权重拆分用同一比例口径——杜绝"权重按 A 比例拆、
    折线按 B 比例走"的混配。
    """
    lo, hi = (a_ratio, b_ratio) if a_ratio <= b_ratio else (b_ratio, a_ratio)
    part = substring(line, lo * line.length, hi * line.length)
    pts = tuple((x, y) for x, y in part.coords)
    return tuple(reversed(pts)) if a_ratio > b_ratio else pts


class _Snap(NamedTuple):
    """查询点吸附结果。

    node 非空 = 端部投影（容差内）直接落既有节点，免拆边；
    node 空 = 边中部投影，需虚拟节点按比例接入（edge_idx/ratio/proj 有效）。
    dist_m 为点击点→投影点直线距离（接入段，不计入里程，单独透出供前端展示）。
    """

    node: tuple[int, int] | None
    edge_idx: int | None
    ratio: float
    proj: tuple[float, float]
    dist_m: float


class RoadGraph:
    """路网图：网格吸附构图 + 双口径权重 + 边级投影吸附路径查询。"""

    def __init__(self, edges: Iterable[Edge]) -> None:
        step_lng = SNAP_CELL_M / (111_320.0 * math.cos(math.radians(REFERENCE_LAT)))
        step_lat = SNAP_CELL_M / 110_540.0

        self._step = (step_lng, step_lat)

        # 平行边（同节点对多条 OSM 边）按 (length_m, edge_id) 取最小——距离最短者为胜者，
        # 其时长由该边自身限速推导（两口径同源，禁止"距离取 A 边、时长取 B 边"混配）
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

            if u_cell == v_cell:
                # 两端同格（<格宽的短边）已合并为同一节点：连通性由相邻边保持，自环无图意义
                excluded["self_loop"] += 1
                continue

            key = (u_cell, v_cell) if u_cell <= v_cell else (v_cell, u_cell)
            prev = best_edge.get(key)
            if prev is None or (e.length_m, e.edge_id) < (prev.length_m, prev.edge_id):
                best_edge[key] = e

        graph = nx.Graph()
        for (ku, kv), e in best_edge.items():
            # 时长（分）= 距离（km）÷ 限速（km/h）× 60——分子必须先除 1000 折算千米，
            # 否则把米当千米时长放大 1000 倍（权重单位语义，单测已固化）
            speed = CLASS_SPEED_KMH.get(e.road_class or "", DEFAULT_SPEED_KMH)
            coords = (
                tuple(e.coords)
                if e.coords
                else ((e.from_lng, e.from_lat), (e.to_lng, e.to_lat))
            )
            # 归一化键序（u≤v）与原始折线方向（from→to）可能相反——统一翻转折线，
            # 确立「键序=折线方向」不变量：coords[0] 在 u 侧、coords[-1] 在 v 侧。
            # 投影比例、部分边拆分、路径拼接全部依赖该不变量，方向错位会把
            # 投影点接到对侧节点（路径凭空缩短/加长）。
            fu = _cell_of(e.from_lng, e.from_lat, step_lng, step_lat)
            if fu != ku:
                coords = tuple(reversed(coords))
            graph.add_edge(
                ku,
                kv,
                weight_m=round(e.length_m, 2),
                weight_min=round(e.length_m / 1000.0 / speed * 60.0, 4),
                edge_id=e.edge_id,
                coords=coords,
                ends=(ku, kv),
            )

        self.graph = graph
        self.unknown_classes = sorted(unknown_classes)

        # 边级空间索引（查询期投影吸附用）：顺序 = 构图插入序（输入序确定 → 吸附
        # 平局可判）。折线取真实顶点，吸附距离与投影都按真实几何算。
        self._edge_keys = list(graph.edges)
        self._edge_lines = [LineString(graph.edges[u, v]["coords"]) for u, v in self._edge_keys]
        self._edge_tree = STRtree(self._edge_lines)
        self._qlock = threading.Lock()

        # 孤岛统计（孤岛不静默吞）——无向分量数与最大分量占比入构图日志
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

    # ---- 吸附 ----

    def _snap_query(self, lng: float, lat: float) -> _Snap | None:
        """点击点 → 最近道路边投影。

        平局规则：距离相等取构图序更早的边（源表 ORDER BY id → 等 id 路径序，
        确定性契约）。端部投影（容差内）直接返回落点节点，免拆边——点击恰在
        路口附近时 edgeCount/里程语义与节点吸附完全一致。
        """
        point = Point(lng, lat)
        rad_deg = QUERY_SNAP_RADIUS_M / _DEG_TO_M
        cand = self._edge_tree.query(point, predicate="dwithin", distance=rad_deg)
        best: tuple[float, int] | None = None
        for i in cand.tolist():
            d_m = shapely.distance(self._edge_lines[i], point) * _DEG_TO_M
            if d_m > QUERY_SNAP_RADIUS_M:
                continue  # 粗筛缓冲纬向偏大，精确判定收口
            k = (d_m, i)
            if best is None or k < best:
                best = k
        if best is None:
            return None
        d_m, i = best
        line = self._edge_lines[i]
        u, v = self._edge_keys[i]
        if line.length <= 0:
            return _Snap(u, i, 0.0, line.coords[0], d_m)  # 退化保护：零长边按起点节点接入
        proj_len = shapely.line_locate_point(line, point)
        ratio = proj_len / line.length
        if ratio <= 1e-9:
            return _Snap(u, i, 0.0, line.coords[0], d_m)
        if ratio >= 1.0 - 1e-9:
            return _Snap(v, i, 1.0, line.coords[-1], d_m)
        p = line.interpolate(proj_len)
        return _Snap(None, i, ratio, (p.x, p.y), d_m)

    # ---- 查询 ----

    def _attach(self, snap: _Snap, key: tuple[str]) -> tuple:
        """把吸附结果接入图，返回寻路起点节点键。

        节点吸附零改动复用既有节点；边中部投影加虚拟节点，与两侧端点按投影
        比例连部分边——权重与折线同比例拆分（距离口径按长度比例精确；时长
        口径因边内限速恒定同样精确）。
        """
        if snap.node is not None:
            return snap.node
        u, v = self._edge_keys[snap.edge_idx]  # type: ignore[index]
        e = self.graph.edges[u, v]
        line = self._edge_lines[snap.edge_idx]  # type: ignore[index]
        r = snap.ratio
        self.graph.add_edge(
            key,
            u,
            weight_m=round(e["weight_m"] * r, 2),
            weight_min=round(e["weight_min"] * r, 4),
            edge_id=e["edge_id"],
            coords=_slice_coords(line, r, 0.0),
            ends=(key, u),
        )
        self.graph.add_edge(
            key,
            v,
            weight_m=round(e["weight_m"] * (1.0 - r), 2),
            weight_min=round(e["weight_min"] * (1.0 - r), 4),
            edge_id=e["edge_id"],
            coords=_slice_coords(line, r, 1.0),
            ends=(key, v),
        )
        return key

    def _link_same_edge(self, o_snap: _Snap, d_snap: _Snap) -> None:
        """起终点投影到同一条边中部时，显式连直达段。

        不连的话两虚拟节点只能经该边两侧端点绕行——同向中段两点会被迫
        多走"投影→端点→投影"的半边冤枉路。直达段权重 = 两投影比例差的
        绝对值 × 边权重（同比例口径）。
        """
        if o_snap.node is not None or d_snap.node is not None:
            return
        if o_snap.edge_idx != d_snap.edge_idx:
            return
        u, v = self._edge_keys[o_snap.edge_idx]  # type: ignore[index]
        e = self.graph.edges[u, v]
        line = self._edge_lines[o_snap.edge_idx]  # type: ignore[index]
        frac = abs(d_snap.ratio - o_snap.ratio)
        self.graph.add_edge(
            _ORIGIN_KEY,
            _DEST_KEY,
            weight_m=round(e["weight_m"] * frac, 2),
            weight_min=round(e["weight_min"] * frac, 4),
            edge_id=e["edge_id"],
            coords=_slice_coords(line, o_snap.ratio, d_snap.ratio),
            ends=(_ORIGIN_KEY, _DEST_KEY),
        )

    def _detach(self) -> None:
        """摘除本查询的全部虚拟节点（连带其部分边/直达边），图恢复共享原貌。"""
        for key in (_ORIGIN_KEY, _DEST_KEY):
            if key in self.graph:
                self.graph.remove_node(key)

    def _assemble(
        self, path: list, from_pt: tuple[float, float], to_pt: tuple[float, float]
    ) -> list[list[float]]:
        """沿路径拼接真实道路折线，首尾以点击点接驳（与端点标记视觉衔接）。

        逐边取构图存的 coords（真实顶点），ends 属性判定行进方向是否要反向；
        相邻段公共端点去重。段间因 60m 网格吸附可能存在米级缝隙（各段端点是
        各自真实几何的端点，非格代表点）——公里级路径上不可见，保留真实几何
        不强行焊缝。
        """
        coords: list[list[float]] = [[from_pt[0], from_pt[1]]]

        def push(x: float, y: float) -> None:
            last = coords[-1]
            if abs(last[0] - x) < 1e-9 and abs(last[1] - y) < 1e-9:
                return
            coords.append([x, y])

        for a, b in zip(path, path[1:]):
            e = self.graph.edges[a, b]
            seg = e["coords"]
            if e["ends"] != (a, b):
                seg = tuple(reversed(seg))
            for x, y in seg:
                push(x, y)
        push(to_pt[0], to_pt[1])
        return coords

    def find_path(
        self,
        from_lng: float,
        from_lat: float,
        to_lng: float,
        to_lat: float,
        mode: str = "distance",
    ) -> dict:
        """路径查询。不可达/未吸附返回合法空结果（found=False + reason），不抛异常。

        吸附为边级投影（模块 docstring）：点击点经投影虚拟节点接入路网，
        里程 = 路网边累计（虚拟部分边是真实路段的比例切片，同口径）；
        点击点→投影点的直线接入距离单独透出（snapDistanceM），不计入里程。
        """
        if mode not in MODE_WEIGHT:
            raise ValueError(f"mode 必须为 {' / '.join(MODE_WEIGHT)}，收到：{mode}")
        weight_attr = MODE_WEIGHT[mode]

        o_snap = self._snap_query(from_lng, from_lat)
        if o_snap is None:
            return {"found": False, "reason": "origin_not_snapped"}
        d_snap = self._snap_query(to_lng, to_lat)
        if d_snap is None:
            return {"found": False, "reason": "destination_not_snapped"}

        with self._qlock:  # 共享单例图：接入→寻路→拼接→摘除必须原子
            try:
                o_key = self._attach(o_snap, _ORIGIN_KEY)
                d_key = self._attach(d_snap, _DEST_KEY)
                self._link_same_edge(o_snap, d_snap)
                try:
                    path = nx.shortest_path(self.graph, o_key, d_key, weight=weight_attr)
                except nx.NetworkXNoPath:
                    return {"found": False, "reason": "unreachable"}

                distance_m = 0.0
                duration_min = 0.0
                for a, b in zip(path, path[1:]):
                    edge = self.graph.edges[a, b]
                    distance_m += edge["weight_m"]
                    duration_min += edge["weight_min"]
                coords = self._assemble(path, (from_lng, from_lat), (to_lng, to_lat))
            finally:
                self._detach()

        return {
            "found": True,
            "mode": mode,
            "distanceM": round(distance_m, 1),
            "durationMin": round(duration_min, 1),
            "snapDistanceM": {
                # 起终点直线接入段不计入里程（诚实口径：里程=路网边累计），单独透出供前端展示
                "from": round(o_snap.dist_m, 1),
                "to": round(d_snap.dist_m, 1),
            },
            "edgeCount": len(path) - 1,
            "coordinates": coords,
        }
