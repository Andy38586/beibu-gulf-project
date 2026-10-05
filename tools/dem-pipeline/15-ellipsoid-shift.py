#!/usr/bin/env python3
"""15-ellipsoid-shift.py — EGM96 正高栅格 → 大地高（椭球高）：h_ell = H + N(x,y)。

用户 2026-10-05 裁定：3D 页面与海陆 DEM 的**统一高程基准 = 大地高（椭球高）**；
陆地在手先转，海侧待近岸测深数据到位后再修正。
输入：NGA EGM96 15′ 网格（PROJ 分发件 us_nga_egm96_15.tif，本机 .local/proj/，md5 03C4D180…）。
输出：与输入同网格的 Int16 大地高栅格（nodata 原样保留）。
用法（venv）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 \
    tools/dem-pipeline/15-ellipsoid-shift.py --dem <in.tif> --out <out.tif>
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

REPO = Path(__file__).resolve().parents[2]
GRID_DEFAULT = REPO / ".local/proj/us_nga_egm96_15.tif"
SAMPLES = {
    "madao": (108.93922, 22.44632),
    "qishi": (108.94146, 22.32265),
    "qingnian": (108.65500, 22.01020),
    "port": (108.64655, 21.67530),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--grid", default=str(GRID_DEFAULT))
    a = ap.parse_args()

    with rasterio.open(a.dem) as src:
        dem = src.read(1)
        prof = src.profile.copy()
        nodata = src.nodata
        shape, crs, transform = dem.shape, src.crs, src.transform
        with rasterio.open(a.grid) as g:
            nd = np.empty(shape, dtype="float32")
            reproject(
                source=rasterio.band(g, 1),
                destination=nd,
                src_transform=g.transform,
                src_crs=g.crs,
                dst_transform=transform,
                dst_crs=crs,
                resampling=Resampling.bilinear,
            )

    valid = np.isfinite(dem)
    if nodata is not None:
        valid &= dem != nodata
    valid &= np.abs(dem.astype("float64")) < 100000  # 兜底哨兵

    shifted = np.where(valid, np.rint(dem.astype("float64") + nd.astype("float64")), dem)
    shifted = np.clip(shifted, -32768, 32767).astype("int16")
    prof.update(dtype="int16", nodata=nodata)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out, "w", **prof) as dst:
        dst.write(shifted, 1)

    n_valid = nd[valid]
    print(
        "N over DEM: min %.2f / mean %.2f / max %.2f m ｜ 有效像元 %d/%d"
        % (n_valid.min(), n_valid.mean(), n_valid.max(), int(valid.sum()), valid.size)
    )
    with rasterio.open(a.grid) as g:
        for k, (lng, lat) in SAMPLES.items():
            nv = float(next(g.sample([(lng, lat)]))[0])
            print("  %-9s N=%+.2f  → 设计水位 %s 换算用此值" % (k, nv, "62.30/35.00/8.70" if k != "port" else "-"))
    before = dem[valid].astype("float64")
    after = shifted[valid].astype("float64")
    print(
        "像元改正：Δ 中位 %+.2f ｜ P10 %+.2f ｜ P90 %+.2f ｜ 输出 %s (%d B)"
        % (np.median(after - before), np.percentile(after - before, 10), np.percentile(after - before, 90), out, out.stat().st_size)
    )
    md5 = hashlib.md5(out.read_bytes()).hexdigest().upper()
    print("md5:", md5)


if __name__ == "__main__":
    main()
