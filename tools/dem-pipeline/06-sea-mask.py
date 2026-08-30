"""
06-sea-mask.py — 海岸线矢量海掩膜（2026-08-30，全链路重算配套）

背景：两个候选 DEM 的海面语义都有缺陷——
  ASTER GDEM：海面为整 0 值（非 nodata），连通性演算把海面算成"淹没"；
  GLO-30：海面为 0~13m 成片伪值且大陆侧沿海地形偏高 12~30m，不适用沿海淹没。
WorldCover 水类在外海 75% 缺失、水域矢量不含海，均不可用。

方法（真实数据派生，标准制图约定）：
  海 = 海岸线矢量（beibu-coastline.geojson，~73k 顶点 ~14m 间距）以南。
  逐栅格列取海岸线顶点最大 northing = 大陆岸线；像素中心 northing 小于该值即海，
  置 nodata。岛屿（涠洲岛等，位于大陆岸线以南）并入海掩膜——披露的已知取舍。
  最终链用 ASTER（沿海低地真实）+ 本掩膜（海面干净）。

用法（CRS 通用，源 DEM 任意投影）：
  .venv/Scripts/python.exe tools/dem-pipeline/06-sea-mask.py <源DEM> <输出DEM> [海岸线geojson]
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform

DEFAULT_COAST = Path(
    r"C:/Users/JionHappY/Desktop/_北部湾项目/数据_/项目数据/海岸线/beibu-coastline.geojson"
)
# 海岸线顶点收集框（略大于裁切框，保证逐列插补有界外余量）
BOX = (106.9, 110.1, 20.9, 23.1)


def collect_coast_vertices(geojson_path):
    j = json.load(open(geojson_path, encoding="utf-8"))
    lons, lats = [], []

    def walk(c):
        for x in c:
            if isinstance(x[0], (int, float)) and isinstance(x[1], (int, float)):
                lons.append(x[0])
                lats.append(x[1])
            elif x:
                walk(x)

    for f in j["features"]:
        if f.get("geometry"):
            walk(f["geometry"]["coordinates"])
    lons, lats = np.array(lons), np.array(lats)
    m = (lons >= BOX[0]) & (lons <= BOX[1]) & (lats >= BOX[2]) & (lats <= BOX[3])
    return lons[m], lats[m]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src_p, out_p = Path(sys.argv[1]), Path(sys.argv[2])
    coast_p = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_COAST

    lons, lats = collect_coast_vertices(coast_p)
    with rasterio.open(src_p) as src:
        t = src.transform
        w, h = src.width, src.height
        dem = src.read(1)
        prof = src.profile
        xs, ys = transform("EPSG:4326", src.crs, lons.tolist(), lats.tolist())

    xs, ys = np.array(xs), np.array(ys)
    cols = ((xs - t.c) / t.a).astype(int)
    coast_y = np.full(w, -np.inf)
    np.maximum.at(coast_y, np.clip(cols, 0, w - 1), ys)  # 每列最大 northing = 大陆岸线
    valid = np.where(coast_y > -np.inf)[0]
    coast_y = np.interp(np.arange(w), valid, coast_y[valid])  # 空列最近插补

    northing = t.f + np.arange(h) * t.e
    sea = northing[:, None] < coast_y[None, :]
    print(f"海岸线顶点(框内): {len(xs)} | sea mask: {100 * sea.mean():.1f}%")

    dem[sea] = prof["nodata"]
    with rasterio.open(out_p, "w", **prof) as dst:
        dst.write(dem, 1)
    print(f"written: {out_p}")


if __name__ == "__main__":
    main()
