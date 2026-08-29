"""诊断：淹没多边形 vs DEM 高程基准是否一致
判据：某档（如 2m）淹没多边形内，DEM 高程应几乎全部 <= 2m；
     若大量点 > 水位，说明多边形与当前 DEM 不同源/不同高程基准（坐标系或垂直基准漂移）。
"""
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "flood-service"))
import numpy as np
import rasterio
from rasterio.warp import transform_geom
from shapely.geometry import shape as shp_shape
from shapely.ops import unary_union
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
DEM = Path(
    r"C:/Users/JionHappY/Desktop/_北部湾项目/数据_/项目数据/浸没分析/处理成果/filled_CGCS2000_int16.tif"
)
GZ = ROOT / "backend/data/flood/flood_levels.json.gz"
LEVELS = [2, 5, 10, 15]

with gzip.open(GZ, "rt", encoding="utf-8") as f:
    levels_gz = json.load(f)

with rasterio.open(DEM) as src:
    crs = src.crs
    nodata = src.nodata
    dem = src.read(1)
    print(f"DEM: {src.width}x{src.height} res={abs(src.transform.a):.1f}m nodata={nodata}")
    print(f"CRS: {crs.to_string()[:90]}")
    print(f"高程范围(全图): {dem[dem != nodata].min()} ~ {dem[dem != nodata].max()} m\n")

    def to_dem(lng, lat):
        gj = transform_geom("EPSG:4326", crs, {"type": "Point", "coordinates": [lng, lat]})
        return gj["coordinates"]

    for lv in LEVELS:
        feats = levels_gz[f"{lv:.1f}"]["features"]
        poly = unary_union([shp_shape(f["geometry"]) for f in feats])
        minx, miny, maxx, maxy = poly.bounds
        # 在多边形范围内均匀采样网格
        N = 40
        pts = []
        for i in range(N):
            for j in range(N):
                lng = minx + (maxx - minx) * (i + 0.5) / N
                lat = miny + (maxy - miny) * (j + 0.5) / N
                pts.append((lng, lat))
        prepared = prep(poly)
        inside = [(lng, lat) for lng, lat in pts if prepared.contains(shp_shape({"type": "Point", "coordinates": [lng, lat]}))]
        if not inside:
            print(f"水位 {lv}m: 采样点均不在多边形内（多边形过小/采样过疏）")
            continue
        elevs = []
        for lng, lat in inside:
            x, y = to_dem(lng, lat)
            for val in src.sample([(x, y)]):
                v = float(val[0])
                if v != nodata and v > -1e9:
                    elevs.append(v)
                break
        if not elevs:
            print(f"水位 {lv}m: 多边形内无有效 DEM 高程（全部 NoData）")
            continue
        arr = np.array(elevs)
        over = int((arr > lv).sum())
        print(
            f"水位 {lv}m: 多边形内采样 {len(inside)} 点(有效{len(arr)}) | "
            f"DEM 高程 {arr.min():.1f}~{arr.max():.1f}m 均值{arr.mean():.2f}m | "
            f"** 超过水位的点: {over}/{len(arr)} ({100*over/len(arr):.1f}%) **"
        )
        if over / len(arr) > 0.05:
            print("   ⚠️ 多边形与 DEM 高程基准不一致（多边形内大量地面高于水位）")
