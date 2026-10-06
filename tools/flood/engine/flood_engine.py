"""
flood_engine.py — 连通性淹没演算引擎（路线 B ④）

海面淹没模型（风暴潮/海平面抬升）：
  水从**永久水体**进入，只淹没与永久水体 8 连通的高程低于水位的区域。
  永久水体 = 无测深 DEM 的 NoData（海掩膜）∪ 含测深 DEM 的 dem<=0 像元。
  算法：mask = (DEM <= level) → 与永久水体合并做连通域标注 →
        保留"永久水体分量"中的淹没区。

  为什么必须有 dem<=0 这一支（2026-10-04）：海陆一体 DEM 把海侧从 NoData 换成了
  真实水深（负值），若仍只拿 NoData 当种子，深水区（dem<0 但 > level 的像元）
  既不"被淹"也不在种子里 ⇒ 近岸淹没区与残存 NoData 之间连通断开，低档结果失真。
  对无负值像元的陆地-only DEM，本支自动退回 NoData 种子，逐像素保持旧行为
  （已由 tools/flood/engine/test_flood_engine.py 钉住）。

与 Priority Flood（richdem）的区别（面试可讲）：
  Priority Flood 是"上游来水"模型（水沿高程路径从源点蔓延，需先填满低处）。
  本项目是"海平面抬升"模型——水平面全局升高，与海面连通即被淹，
  连通域过滤（mask + 种子连通）就是标准解，无需 richdem（其 Windows 编译也是坑）。

依赖：numpy / scipy / rasterio（rasterio wheel 自带 GDAL，无需 osgeo）。
输入：backend/data/flood/dem/ 下优先 landsea（海陆一体，含测深），
      回退 filled_utm48n_cut.tif（陆地填洼版，海=NoData）；
      两者同为 UTM48N/30m、EGM96 口径。
输出：EPSG:4326 的淹没多边形 GeoJSON FeatureCollection + 统计。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from affine import Affine
from rasterio.features import shapes as rio_shapes
from rasterio.warp import transform_geom
from scipy import ndimage

# 仓库根锚点：本文件在 tools/flood/engine/ 下（2026-09-26 自原 algorithm-service 拆出，
# 拆出时曾用 parents[1]，搬迁后指向 tools/flood ⇒ DEM/waterLevel 全部解析到不存在的
# tools/flood/data/...，生成链自 9-26 起不可跑；2026-10-04 修正为显式 parents[3]）。
REPO_ROOT = Path(__file__).resolve().parents[3]

# 输入：钦北防范围、填洼、UTM48N 裁切版（路线 B ① 的产物）
# DEM 路径多级回退（2026-08-30）：workspace dem/ 副本曾被本机清理进程删除
# （原 169MB 版 8-27 被清理）；部署/CI 与外部数据树用 FLOOD_DEM_PATH 显式覆盖。
# 复原命令见 tools/dem-pipeline/06-restore-cut-dem.ps1。
def _resolve_dem_path() -> Path:
    import os

    env = os.environ.get("FLOOD_DEM_PATH")
    if env:
        return Path(env)
    # 海陆一体 DEM 优先（2026-10-04 统一海陆基准的落地口径）：同名目录下若存在
    # landsea_utm48n.tif，则淹没演算与地形重切共用这一份海陆一体地表；缺失时
    # 回退陆地填洼版（旧行为），保证部署环境未同步资产时不炸。
    merged = (
        REPO_ROOT
        / "backend"
        / "data"
        / "flood"
        / "dem"
        / "landsea_utm48n.tif"
    )
    if merged.exists():
        return merged
    repo = (
        REPO_ROOT
        / "backend"
        / "data"
        / "flood"
        / "dem"
        / "filled_utm48n_cut.tif"
    )
    if repo.exists():
        return repo
    # 外置数据树不随仓库分发，数据未同步时回落仓库内路径，缺失由调用方报错，
    # 不静默换源（外置覆盖口只有上面的 FLOOD_DEM_PATH）。
    return repo


DEM_PATH = _resolve_dem_path()

# 垂直基准偏移（理论深度基准面 − EGM96，米）：waterLevel.json 的 baseLevels.msl=2.5
# 表示「理论深度基准面水位 H」对应 EGM96 正高 H−2.5。本引擎的 DEM 比较与 251 档
# 产物均为 EGM96 口径（run_online_flood 契约即 EGM96 输入），online 入口须先把前端
# 传来的理论水位换算后再查表/演算（见 main.py，2026-08-29 垂直基准统一）。
# 单一数据源：从 waterLevel.json 读取，不硬编码（与 tools/flood/flood_realify.py 同口径）。
_WATER_LEVEL_JSON = (
    REPO_ROOT / "backend" / "data" / "flood" / "waterLevel.json"
)
_datum_offset_cache: float | None = None


def datum_offset() -> float:
    """垂直基准偏移（米）。msl 缺失时抛 RuntimeError——静默回 0 会复活基准错配 bug。"""
    global _datum_offset_cache
    if _datum_offset_cache is None:
        import json

        wl = json.loads(_WATER_LEVEL_JSON.read_text(encoding="utf-8"))
        msl = next(
            (b["height"] for b in wl.get("baseLevels", []) if b.get("id") == "msl"),
            None,
        )
        if msl is None:
            raise RuntimeError(
                "waterLevel.json 缺少 baseLevels.msl，无法确定垂直基准偏移"
            )
        _datum_offset_cache = float(msl)
    return _datum_offset_cache

# 分辨率：30m 全分辨率演算（2026-08-30 由 4x 降采样改回 1x）。
# 原 4x（120m）在陡梯度海岸的最近邻混合使产物多边形含 ~18% 超水位高地
# （diag_datum 实测）；全分辨率消除此伪影。裁切版 ~5900 万像元，
# 内存 ~236MB float32、单档秒级，服务与预计算均可接受。
DOWNSAMPLE = 1

# 8 连通结构（含对角）
STRUCT8 = np.ones((3, 3), dtype=bool)

# 输出简化：过滤面积小于该值（4326 度²）的碎片多边形。
# 2026-10-05 A4 裁定③（D2 修复）：原 0.0002°² 在本纬度 ≈2.28km²，是注释本意 0.25km²
# 的 10 倍 ⇒ 把 0.25~2.28km² 的合法淹没片整片丢掉；对齐为 0.00002°²（≈0.23km²，1°²≈11,400km²@22°N）。
MIN_AREA_DEG2 = 0.00002


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
    连通性淹没 mask（与永久水体 8 连通的低洼区）。

    返回与输入同形的 bool 数组：True = 被淹没。
    """
    nodata_mask = _nodata_mask(dem, nodata)
    source = water_source_mask(dem, nodata)

    flooded = (dem <= level) & ~nodata_mask
    if not flooded.any():
        return np.zeros_like(dem, dtype=bool)

    # 淹没区 + 永久水体合并标注连通域，保留与永久水体同一分量的淹没区。
    # 深水区（dem<0 且 >level）不参与输出，但必须在 combined 里保持连通，
    # 否则海面被"未淹没的深水"切断，近岸淹没区会与种子分量失联。
    combined = flooded | source
    labels, _n = ndimage.label(combined, structure=STRUCT8)
    sea_labels = np.unique(labels[source])
    sea_labels = sea_labels[sea_labels > 0]
    if sea_labels.size == 0:
        return np.zeros_like(dem, dtype=bool)
    connected = np.isin(labels, sea_labels)
    return connected & flooded


def _nodata_mask(dem: np.ndarray, nodata: float) -> np.ndarray:
    """无数据掩膜（nodata 哨兵 ∪ NaN）。"""
    if nodata is None:
        return np.isnan(dem)
    return (dem == nodata) | np.isnan(dem)


def water_source_mask(dem: np.ndarray, nodata: float) -> np.ndarray:
    """
    永久水体（淹没种子）掩膜。

    - 无测深 DEM（无有效负值像元）：种子 = NoData（= 海掩膜），与旧实现逐像素一致；
    - 含测深 DEM（存在有效 dem<0）且有 NoData 锚点：种子 = 与 NoData **连通**的
      dem<=0 分量 ∪ NoData——被堤坝围住的负高程养殖塘/坑塘不得当成海源
      （否则海平面抬升会先淹穿堤后土地，属高估）；
    - 含测深 DEM 但全图无 NoData（未来换源可能）：没有开海锚点，退化为
      "所有 dem<=0 像元即水体"，并在此声明该假设。

    本项目工作区（广西沿海）NoData 即 SRTM15+ 覆盖外的开海西/东缘，锚点成立。
    若未来换入"内陆空洞 + 全填充海"的 DEM，需把锚点从 NoData 改为开海边界矢量。
    """
    nodata_mask = _nodata_mask(dem, nodata)
    valid = ~nodata_mask
    has_bathymetry = bool(np.any(valid & (dem < 0)))
    if not has_bathymetry:
        return nodata_mask
    candidate = nodata_mask | (valid & (dem <= 0))
    if not nodata_mask.any():
        return candidate
    labels, _n = ndimage.label(candidate, structure=STRUCT8)
    open_labels = np.unique(labels[nodata_mask])
    open_labels = open_labels[open_labels > 0]
    if open_labels.size == 0:
        return candidate
    return candidate & np.isin(labels, open_labels)


def mask_to_geojson(
    mask: np.ndarray,
    transform: Affine,
    crs: object,
    simplify_tol: float = 300.0,
) -> list[dict]:
    """
    淹没 mask → EPSG:4326 多边形（GeoJSON Feature 列表）。
    simplify_tol：Douglas-Peucker 简化容差（米，UTM 系；默认 300m，与预计算档位表一致——
    确保查表命中与兜底演算几何同容差）。
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
        if poly.is_empty:
            continue
        # 简化可能产出 MultiPolygon（点接触组件/拓扑分裂）——按 part 逐个
        # 走同一过滤链，不再整体丢弃（曾静默低估淹没面积/featureCount）
        parts = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
        for part in parts:
            if part.geom_type != "Polygon" or part.area < 250_000:
                continue  # < 0.25 km²（UTM m²）
            # 过滤小内环（<0.25 km² 的未淹没斑块）——沿海岸细碎条带淹没区多边形化后
            # 产生"外环包围海面 + 数千内环"的巨型复杂几何（实测 15m 档 3163 内环），
            # 渲染时外环覆盖海面、hole 挖空不完全 → 用户看到"多边形大部分在海上"。
            # 只保留大的洞（海湾/大湖），小斑块并入外环（视觉可接受，几何大幅简化）。
            if len(part.interiors) > 0:
                from shapely.geometry import Polygon as ShapelyPolygon

                # D1 修复（2026-10-05 A4 裁定③）：shapely 2.x 的 LinearRing.area 恒为 0
                # （Polygon(ring).area 才是有向面积）⇒ 原判据 abs(ring.area)>=250_000 恒假、
                # 一个洞都不留（与上句注释相反）。Polygon(ring) 对自相交环走 shoelace、
                # 不抛异常，判定可跑（探针实测误差面 ≤0.7%）。
                keep_holes = [
                    ring for ring in part.interiors if abs(ShapelyPolygon(ring).area) >= 250_000
                ]
                if len(keep_holes) < len(part.interiors):
                    part = (
                        ShapelyPolygon(part.exterior, keep_holes)
                        if keep_holes
                        else ShapelyPolygon(part.exterior)
                    )
            # 转 4326 并记录面积（度² 用于排序）
            g4326 = _utm_to_4326(part)
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


def run_online_flood(level: float, downsample: int = DOWNSAMPLE, simplify_tol: float = 300.0) -> dict:
    """
    在线演算入口：给定水位（米，DEM 高程基准），返回 4326 淹没 GeoJSON + 统计。

    simplify_tol：多边形简化容差（米，UTM 系）。默认 300m，与预计算档位表一致
    （双通道统一表侧容差；视觉差异可忽略（相对 240m 像元），文件体积已由预计算侧控制）。

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
    # 只绘制"被淹没的陆地"（0 < 高程 <= 水位），剔除永久水面（dem<=0，即海洋）。
    # 原因：本项目裁切 DEM 在北纬 21° 等处是一条笔直的数据边界，再往外是 NoData；
    # 0~水位的浅海有效像元一直铺到这条直线，多边形化会沿它封出几十~上百公里的
    # 笔直"缝合边"，把相距遥远的岸段在一个多边形里硬连，前端 earcut 三角剖分成
    # 一束被拉升/挤压的"竖帘"。海洋本就是永久水体、不属于淹没范围，剔除后：
    #   1) 缝合边消失（实测 level10 最大邻边 172km→6.7km）；
    #   2) 淹没面积不再混入大片海面（17960km²→4278km² 的真实陆地淹没）。
    # 连通性通水仍由 compute_flood_mask 借 NoData 海域做 8 连通种子，不受影响。
    land = dem > 0.0
    mask = mask & land
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
