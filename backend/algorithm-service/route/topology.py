"""
route/topology.py — 路网拓扑构建（端点投影切分，纯计算）

背景（T5.2 实施发现，任务卡"节点 snap 容差"假设的修正）：
roads 源数据里 OSM 纵向道路不在路口切断，横路的端点接在纵路的**中间顶点**上——
只合并"首末点重合"的构图策略抓不到这类 T 型连接（实测仅 ~25% 端点精确重合，
主分量占比 28.6%，路网呈碎段状）。而抽样验证 95% 的端点 60m 内有其他路通过——
路网物理连续，缺的是拓扑。

本模块的做法（OSMnx / pgRouting noding 工作流的应用侧轻量版）：
1. 全量边建 STRtree；全部端点一次批量 dwithin 查询（shapely 向量化，
   33 万端点 × 候选对的距离/投影全在 numpy 层——逐对 Python 循环实测 262s，
   向量化后秒级，这是构图耗时的主要来源）；
2. 端点到容差内经过边的投影位置记为切点；
3. 按切点把被穿越边切成多段，段长按"子段平面长 / 全长平面长"比例分摊表的
   length_m（保留大地线口径的总量，分段只按几何比例，Σ段长 == 原边长）；
4. 切点坐标即横路端点坐标 → 下游 RoadGraph 的网格吸附自然把它们合并为同一节点。

已知取舍（显式登记，不静默）：
- 平行路误连：与 T 型连接无法仅凭几何区分（辅道/匝道间距可 <60m）。误连代价
  = ≤容差的对角捷径，对公里级路径影响远小于路网分段粒度；而调小容差会漏真
  连接——按"粗筛宁大勿漏"取宽（02 §5.6.3）。
- 距离近似：dwithin/换算用度空间等距圆柱近似（参考纬度米每度，混合方向误差
  ±20% 级），与 graph.py 吸附同口径；吸附语义本就是模糊容差。
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from typing import NamedTuple

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, MultiPoint
from shapely.ops import split as shapely_split
from shapely.ops import substring

from .graph import SNAP_CELL_M, REFERENCE_LAT, Edge


class RoadLine(NamedTuple):
    """roads 表一行：完整折线几何（拓扑切分的输入，Edge 的上游）"""

    edge_id: int
    road_class: str | None
    length_m: float
    geom: LineString


_logger = logging.getLogger("algorithm-service")

# 度→米的本地近似因子（固定参考纬度，对齐 graph.py 的吸附口径）
_DEG_TO_M = 111_320.0 * math.cos(math.radians(REFERENCE_LAT))


def split_at_endpoints(roads: list[RoadLine], tolerance_m: float = SNAP_CELL_M) -> list[Edge]:
    """把所有边按"他边端点的投影"切分，输出端点形式的 Edge 列表（RoadGraph 输入）。"""
    if not roads:
        return []

    geoms = np.array([r.geom for r in roads], dtype=object)
    lengths = np.array([r.geom.length for r in roads])
    tree = STRtree(geoms)
    buf_deg = tolerance_m / _DEG_TO_M  # 粗筛缓冲（度）：宁大勿漏，精确判定在后

    # 全部端点（原始边顺序展开，首点 + 末点）
    endpoints = shapely.points(
        [c for r in roads for c in (r.geom.coords[0], r.geom.coords[-1])]
    )
    owner = np.repeat(np.arange(len(roads)), 2)  # 每个端点所属的边下标

    hits = tree.query(endpoints, predicate="dwithin", distance=buf_deg)
    src_idx, cand_idx = hits
    keep = cand_idx != owner[src_idx]  # 排除端点所在边自身
    src_idx, cand_idx = src_idx[keep], cand_idx[keep]

    # 候选对批量精判：点到边距离（度）折米 ≤ 容差
    dist_m = shapely.distance(geoms[cand_idx], endpoints[src_idx]) * _DEG_TO_M
    src_idx, cand_idx = src_idx[dist_m <= tolerance_m], cand_idx[dist_m <= tolerance_m]

    # 投影位置（折线长比例）；端部投影无需切分（首末点重合由网格吸附合并）
    proj = shapely.line_locate_point(geoms[cand_idx], endpoints[src_idx])
    ratios = proj / lengths[cand_idx]
    inner = (ratios > 1e-9) & (ratios < 1.0 - 1e-9)

    cut_positions: dict[int, set[float]] = defaultdict(set)
    for j, ratio in zip(cand_idx[inner].tolist(), ratios[inner].tolist()):
        cut_positions[j].add(ratio)

    out: list[Edge] = []
    for i, road in enumerate(roads):
        pieces = _pieces(road.geom, sorted(cut_positions.get(i, ())))
        total_plane = sum(p.length for p in pieces)
        for piece in pieces:
            seg_m = road.length_m * piece.length / total_plane if total_plane else road.length_m
            c0, c1 = piece.coords[0], piece.coords[-1]
            out.append(Edge(road.edge_id, road.road_class, seg_m, c0[0], c0[1], c1[0], c1[1]))

    _logger.info(
        "路网拓扑切分：%d 条原始边 → %d 段（%d 条边被端点投影切分）",
        len(roads),
        len(out),
        len(cut_positions),
    )
    return out


def _pieces(line: LineString, positions: list[float]) -> list[LineString]:
    """按折线长比例位置序列（升序、内点）切分；退化（切点与顶点重合）时按区间截取兜底"""
    if not positions:
        return [line]
    # interpolate 只吃绝对距离（度）：比例必须先乘全线长，否则切点落到终点、
    # 切分静默退化为整线（单测固化的单位混算实锤，与 7.1 同族）
    cut_points = [line.interpolate(p * line.length) for p in positions]
    result = shapely_split(line, MultiPoint(cut_points))
    pieces = [g for g in result.geoms if isinstance(g, LineString) and not g.is_empty]
    if sum(p.length for p in pieces) < line.length * 0.999:
        bounds = [0.0, *positions, 1.0]
        pieces = []
        for a, b in zip(bounds, bounds[1:]):
            if b - a <= 1e-12:
                continue
            piece = substring(line, a * line.length, b * line.length)
            if not piece.is_empty and piece.length > 0:
                pieces.append(piece)
    return pieces
