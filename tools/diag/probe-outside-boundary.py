"""探针：合并 DEM 下，各档淹没面积里有多少落在「陆域行政边界（12 区县）」之外。

口径：与 run_online_flood 同链（compute_flood_mask & land），唯一附加是边界栅格化。
输出：每档 总面积 / 域内 / 域外（km²、占比）+ 域外像元的高程分位与代表点。
来源：2026-10-04 初版驻留 .local/flood-recompute/（gitignored），2026-10-05 原样入库，
使台账 A3 复算钩子满足「判据输入受版本控制」。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "flood" / "engine"))
import flood_engine as fe  # noqa: E402

BOUNDARY = REPO / "frontend" / "public" / "data" / "route-analysis" / "boundary.geojson"


def boundary_mask(transform, crs, shape) -> np.ndarray:
    gj = json.loads(BOUNDARY.read_text(encoding="utf-8"))
    geoms = [transform_geom("EPSG:4326", crs, f["geometry"]) for f in gj["features"]]
    return rasterize(
        [(g, 1) for g in geoms],
        out_shape=shape,
        transform=transform,
        fill=0,
        dtype="uint8",
        all_touched=False,
    ).astype(bool)


def main() -> None:
    dem, nodata, transform, crs = fe.load_dem()
    print(f"DEM {fe.DEM_PATH.name} {dem.shape} crs={crs.to_string()[:12]}")
    inb = boundary_mask(transform, crs, dem.shape)
    print(f"边界内像元 {int(inb.sum())} = {inb.sum() * 0.0009:.0f} km²（占全格 {100 * inb.mean():.1f}%）")
    land = dem > 0
    px = 0.0009
    print("level | total_km2 | inside | outside | outside%")
    for lvl in (0.5, 1.0, 2.0, 3.0, 5.0, 10.0, 25.0):
        m = fe.compute_flood_mask(dem, nodata, lvl) & land
        tot = int(m.sum())
        ins = int((m & inb).sum())
        out = tot - ins
        pct = 100 * out / tot if tot else 0.0
        print(f"{lvl:>5} | {tot * px:9.2f} | {ins * px:7.2f} | {out * px:7.2f} | {pct:5.1f}%")
    # 域外淹没像元的高程与位置画像（3m 档）
    m = fe.compute_flood_mask(dem, nodata, 3.0) & land
    outside = m & ~inb
    rows, cols = np.where(outside)
    if rows.size:
        vals = dem[outside]
        print(
            f"\n3.0m 域外淹没 {rows.size} px = {rows.size * px:.1f} km²；"
            f"高程 p5/p50/p95 = {np.percentile(vals,5):.1f}/{np.percentile(vals,50):.1f}/{np.percentile(vals,95):.1f} m"
        )
        r, c = rows, cols
        print(f"行范围 {r.min()}~{r.max()} / 列范围 {c.min()}~{c.max()}")
        from rasterio.warp import transform as warp_transform

        for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
            i = int(frac * (rows.size - 1))
            x, y = transform * (c[i] + 0.5, r[i] + 0.5)
            lon, lat = warp_transform(crs, "EPSG:4326", [x], [y])
            print(f"  p{int(frac*100):>3}: {lat[0]:.4f}N {lon[0]:.4f}E  h={dem[r[i], c[i]]:.1f}m")


if __name__ == "__main__":
    main()
