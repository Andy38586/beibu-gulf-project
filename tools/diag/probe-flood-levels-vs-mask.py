"""probe-flood-levels-vs-mask.py — 档位多边形 vs 淹没 mask 的一致性探针（只读，不改产物）。

判据（同档位内比较）：
  ① 多边形包围面积 vs mask 像元面积（应≈100%）；
  ② 多边形内 DEM > level 的像元占比（应为 0；非 0 即画出来的范围里有高于水位的干地）。
两条一起用来区分「掩膜连通口径」与「多边形化取舍（简化/填洞/过滤）」各自贡献多少。

用法（venv，需 rasterio；QGIS python 无 rasterio）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 \
      tools/diag/probe-flood-levels-vs-mask.py [level...]      # 默认 5.0
  容差序列固定 [0, 60, 150, 300]（对应 mask_to_geojson 的 simplify_tol，300 是预计算现值）。

2026-10-04 实跑基线（level 5.0m，EGM96，DEM=backend/data/flood/dem/landsea_utm48n.tif）：
  mask 2,132.9 km² ⇒ 多边形 2,710.4 / 2,709.5 / 2,732.3 / 2,788.6 km²
  （mask 的 127.1% / 127.0% / 128.1% / 130.7%），内圈超水位像元 23.82% → 27.52%，最高 373 m。
  tol=0 就已 127.1% ⇒ 主因是"<0.25km² 内环填平"这条渲染取舍，不是简化容差。
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "flood" / "engine"))

from flood_engine import load_dem, compute_flood_mask  # noqa: E402
from flood_engine import mask_to_geojson  # noqa: E402

LEVELS = [float(a) for a in sys.argv[1:]] or [5.0]
TOLS = [0.0, 60.0, 150.0, 300.0]


def main() -> None:
    dem, nodata, transform, crs = load_dem(1)
    with rasterio.open(REPO / "backend/data/flood/dem/landsea_utm48n.tif") as src:
        full = src.read(1)
    for level in LEVELS:
        mask = compute_flood_mask(dem, nodata, level)
        land = dem > 0.0
        mask = mask & land
        px = int(mask.sum())
        print(f"\n=== level {level} m（EGM96）| mask {px} px = {px * 900 / 1e6:.1f} km² ===")
        for tol in TOLS:
            feats = mask_to_geojson(mask, transform, crs, simplify_tol=tol)
            geoms = [transform_geom("EPSG:4326", crs, f["geometry"]) for f in feats]
            if not geoms:
                print(f"  tol={tol:5.0f} m: 0 features")
                continue
            m2 = geometry_mask(geoms, out_shape=full.shape, transform=src.transform, invert=True)
            inside = full[m2 & (full != src.nodata)]
            over = int((inside > level).sum())
            npts = sum(
                len(g["coordinates"][0]) + sum(len(r) for r in g["coordinates"][1:])
                if g["type"] == "Polygon"
                else 0
                for g in (f["geometry"] for f in feats)
            )
            print(
                f"  tol={tol:5.0f} m: feats={len(feats):3d} 面积={inside.size * 900 / 1e6:7.1f} km² "
                f"(mask 的 {100 * inside.size / max(px, 1):5.1f}%) | >level {over} ({100 * over / max(inside.size, 1):5.2f}%) "
                f"| max {inside.max() if inside.size else 0:.0f} m | 顶点≈{npts}"
            )


if __name__ == "__main__":
    main()
