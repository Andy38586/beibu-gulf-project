"""
flood_engine.py — 连通性淹没演算引擎（路线 B ④）

海面淹没模型（风暴潮/海平面抬升）：
  水从海面（DEM NoData 区域）进入，只淹没与海面 8 连通的高程低于水位的区域。
  算法：mask = (DEM <= level) → 与 NoData(海域) 合并做连通域标注 →
        保留"海域分量"中的淹没区。

与 Priority Flood（richdem）的区别（面试可讲）：
  Priority Flood 是"上游来水"模型（水沿高程路径从源点蔓延，需先填满低处）。
  本项目是"海平面抬升"模型——水平面全局升高，与海面连通即被淹，
  连通域过滤（mask + 种子连通）就是标准解，无需 richdem（其 Windows 编译也是坑）。

依赖：numpy / scipy / rasterio（rasterio wheel 自带 GDAL，无需 osgeo）。
输入：backend/data/flood/dem/filled_utm48n_cut.tif（UTM48N，30m，填洼版）
输出：EPSG:4326 的淹没多边形 GeoJSON FeatureCollection + 统计。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from affine import Affine
from rasterio.features import shapes as rio_shapes
from rasterio.warp import transform_geom
from scipy import ndimage

# 输入：钦北防范围、填洼、UTM48N 裁切版（路线 B ① 的产物）
# 本文件位于 backend/flood-service/ → parents[1] = backend/，拼 data/... 即 backend/data/
DEM_PATH = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "flood"
    / "dem"
    / "filled_utm48n_cut.tif"
)

# 降采样因子：原 30m → 120m（4x），像元数 ~6800万 → ~425万，单次演算秒级
DOWNSAMPLE = 4

# 8 连通结构（含对角）
STRUCT8 = np.ones((3, 3), dtype=bool)

# 输出简化：过滤面积小于该值（4326 度²，约 0.25 km²）的碎片多边形
MIN_AREA_DEG2 = 0.0002


def _affine_for_out_shape(src: rasterio.io.DatasetReader, out_shape: tuple[int, int]):
    """降采样读取后的仿射变换：像元尺寸按 out_shape 比例放大。"""
    scale_x = src.width / out_shape[1]
    scale_y = src.height / out_shape[0]
    return src.transform * Affine.scale(scale_x, scale_y)


_dem_cache: dict | None = None


def load_dem(downsample: int = DOWNSAMPLE):
    """读取裁切 DEM（降采样），模块级缓存（425万 float32 ≈ 17MB，服务内只读一次）。"""
    global _dem_cache
    if _dem_cache is not None:
        return _dem_cache
    import rasterio

    with rasterio.open(DEM_PATH) as src:
        out_shape = (src.height // downsample, src.width // downsample)
        data = src.read(1, out_shape=out_shape)
        nodata = src.nodata
        transform = _affine_for_out_shape(src, out_shape)
        crs = src.crs
    _dem_cache = (data, nodata, transform, crs)
    return _dem_cache


def compute_flood_mask(
    dem: np.ndarray, nodata: float, level: float
) -> np.ndarray:
    """
    连通性淹没 mask（与海面 8 连通的低洼区）。

    返回与输入同形的 bool 数组：True = 被淹没。
    """
    if nodata is None:
        nodata_mask = np.isnan(dem)
    else:
        nodata_mask = dem == nodata
    nodata_mask |= np.isnan(dem)

    flooded = (dem <= level) & ~nodata_mask
    if not flooded.any():
        return np.zeros_like(dem, dtype=bool)

    # 淹没区 + 海域合并标注连通域，保留与海域同一分量的淹没区
    combined = flooded | nodata_mask
    labels, _n = ndimage.label(combined, structure=STRUCT8)
    sea_labels = np.unique(labels[nodata_mask])
    sea_labels = sea_labels[sea_labels > 0]
    if sea_labels.size == 0:
        return np.zeros_like(dem, dtype=bool)
    connected = np.isin(labels, sea_labels)
    return connected & flooded


def mask_to_geojson(
    mask: np.ndarray,
    transform: Affine,
    crs: object,
    simplify_tol: float = 180.0,
) -> list[dict]:
    """
    淹没 mask → EPSG:4326 多边形（GeoJSON Feature 列表）。
    simplify_tol：Douglas-Peucker 简化容差（米，UTM 系；默认 180m=1.5 个 120m 像元）。
    先简化再转 4326：UTM 等距投影下容差几何意义一致，避免 4326 度容差在纬向上的畸变。
    """
    import rasterio
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform

    def _utm_to_4326(g):
        # shapely 坐标 → 4326（rasterio.warp.transform_geom 接收 GeoJSON-like dict）
        gj = _shape_to_geojson(g)
        return shape(transform_geom(crs, "EPSG:4326", gj, precision=6))

    features: list[dict] = []
    for geom, val in rio_shapes(
        mask.astype(np.uint8), transform=transform, connectivity=8
    ):
        if val != 1:
            continue
        poly = shape(geom)
        # 简化（UTM 系，容差按米）；过滤极小多边形
        poly = poly.simplify(simplify_tol, preserve_topology=True)
        if poly.is_empty or poly.geom_type != "Polygon" or poly.area < 250_000:
            continue  # < 0.25 km²（UTM m²）
        # b057: 过滤小内环（<0.25 km² 的未淹没斑块）——沿海岸细碎条带淹没区多边形化后
        # 产生"外环包围海面 + 数千内环"的巨型复杂几何（实测 15m 档 3163 内环），
        # 渲染时外环覆盖海面、hole 挖空不完全 → 用户看到"多边形大部分在海上"。
        # 只保留大的洞（海湾/大湖），小斑块并入外环（视觉可接受，几何大幅简化）。
        if len(poly.interiors) > 0:
            keep_holes = [ring for ring in poly.interiors if abs(ring.area) >= 250_000]
            if len(keep_holes) < len(poly.interiors):
                from shapely.geometry import Polygon as ShapelyPolygon

                poly = (
                    ShapelyPolygon(poly.exterior, keep_holes) if keep_holes else ShapelyPolygon(poly.exterior)
                )
        # 转 4326 并记录面积（度² 用于排序）
        g4326 = _utm_to_4326(poly)
        area_deg2 = _polygon_area_deg2(_shape_to_geojson(g4326))
        if area_deg2 < MIN_AREA_DEG2:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"area": round(area_deg2, 6)},
                "geometry": _shape_to_geojson(g4326),
            }
        )

    features.sort(key=lambda f: f["properties"]["area"], reverse=True)
    return features


def _shape_to_geojson(geom) -> dict:
    from shapely.geometry import mapping

    return mapping(geom)


def compute_impact(level: float, features: list[dict], facilities: list[dict]) -> dict:
    """
    设施影响评估：淹没多边形 ∩ 设施点 → 受影响设施 + 总损失（2026-08-06 新增）。

    空间筛选语义：设施点落在任一淹没多边形内 → 计入受影响。
    （淹没多边形本身即"与海面连通且 DEM<=level"的区域——点在多边形内已蕴含
    "设施所在地被淹"的高程语义，无需再比对 facility.elevation。）

    损失模型（value/damageRate 为合理假设的估算值，非实测）：
      loss = value × damageRate
      totalLoss = Σ loss
    value 取自 facilityPoints.json（万元，资产价值估算），damageRate 按设施类型
    （油库 0.9x / 泊位码头 0.8x / 仓储 0.4~0.6x）——可接受为"合理造假"。

    Returns:
      {"level", "affectedFacilities": [{id,name,type,lng,lat,port,loss,damageRate}], "totalLoss"}
    """
    from shapely.geometry import Point, shape

    polys = []
    for f in features:
        geom = f.get("geometry") if isinstance(f, dict) else None
        if geom and geom.get("type") in ("Polygon", "MultiPolygon"):
            try:
                polys.append(shape(geom))
            except Exception:  # noqa: BLE001 —— 单多边形解析失败跳过
                continue
    if not polys:
        return {"level": level, "affectedFacilities": [], "totalLoss": 0}

    affected: list[dict] = []
    total_loss = 0.0
    for fac in facilities:
        try:
            pt = Point(float(fac["lng"]), float(fac["lat"]))
        except (KeyError, TypeError, ValueError):
            continue
        if not any(poly.contains(pt) for poly in polys):
            continue
        damage_rate = float(fac.get("damageRate", 0.1))
        value = float(fac.get("value", 0))
        loss = value * damage_rate
        affected.append(
            {
                "id": fac.get("id", ""),
                "name": fac.get("name", ""),
                "type": fac.get("type", ""),
                "lng": fac["lng"],
                "lat": fac["lat"],
                "port": fac.get("port", ""),
                "loss": round(loss),
                "damageRate": damage_rate,
            }
        )
        total_loss += loss
    return {"level": level, "affectedFacilities": affected, "totalLoss": round(total_loss)}


def _polygon_area_deg2(geom: dict) -> float:
    """多边形面积近似（度²，用于碎片过滤与排序，不做精确投影面积）。"""
    coords = geom.get("coordinates", [])
    if not coords:
        return 0.0
    ring = coords[0]
    if len(ring) < 4:
        return 0.0
    # 鞋带公式（经纬度平面近似）
    area = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][:2]
        x2, y2 = ring[i + 1][:2]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def run_online_flood(level: float, downsample: int = DOWNSAMPLE, simplify_tol: float = 180.0) -> dict:
    """
    在线演算入口：给定水位（米，DEM 高程基准），返回 4326 淹没 GeoJSON + 统计。

    simplify_tol：多边形简化容差（米，UTM 系）。默认 180m（1.5 个 120m 像元）；
    预计算档位表（precompute_levels.py）传更大值（300m）压缩数据量——
    视觉差异可忽略（相对 240m 像元），文件体积显著下降。

    Returns:
      {
        "level": level,
        "featureCount": int,
        "floodedKm2": float,   # 淹没面积（km²，近似）
        "features": [...],
      }
    """
    dem, nodata, transform, crs = load_dem(downsample)
    mask = compute_flood_mask(dem, nodata, level)
    flooded_px = int(mask.sum())
    # UTM48N 降采样后像元面积：120m × 120m（近似；沿纬度略有变化，可忽略）
    px_area_km2 = (30 * downsample / 1000.0) ** 2
    flooded_km2 = flooded_px * px_area_km2

    features = mask_to_geojson(mask, transform, crs, simplify_tol=simplify_tol)
    return {
        "level": level,
        "downsample": downsample,
        "featureCount": len(features),
        "floodedKm2": round(flooded_km2, 2),
        "features": features,
    }


if __name__ == "__main__":
    import json
    import sys
    import time

    level = float(sys.argv[1]) if len(sys.argv) > 1 else 3.5
    t0 = time.time()
    result = run_online_flood(level)
    print(f"水位 {level}m: {result['featureCount']} 个多边形, "
          f"淹没 {result['floodedKm2']} km², 耗时 {time.time()-t0:.2f}s")
    out = Path(__file__).parent / "flood_demo.json"
    with out.open("w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"已写出 {out}")
