# -*- coding: utf-8 -*-
"""probe-seam-pairs.py — 跨缝相邻像元差（只读）：区分"入水梯度"与"基准台阶"。

用法（QGIS python，需 osgeo/numpy）：
  & 'C:\\Program Files\\QGIS 3.44.12\\apps\\Python312\\python.exe' -X utf8 \\
    tools/diag/probe-seam-pairs.py <CUT.tif> <OUT.tif> [OUT2.tif ...]

CUT 的 nodata（32767）侧记为"海"；对每个 OUT 取 4 邻域上 land↔sea 相邻像元对，
输出（海−陆）差的 n / 中位 / P5 / P25 / P75 / P95。OUT 与 CUT 必须同网格。

口径：中位≈0 ⇒ 缝处连续；中位显著为负但 P75/P95 近 0、仅尾部深 ⇒ 近岸梯度
（海源分辨率边界）；整段常量平移（中位≈P5≈P95）⇒ 疑似基准台阶。
"""
import sys

import numpy as np
from osgeo import gdal

gdal.UseExceptions()
NOD = 32767


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    dc = gdal.Open(sys.argv[1])
    cut = dc.GetRasterBand(1).ReadAsArray()
    h, w = cut.shape
    land_mask = cut != NOD
    ys, xs = np.arange(h)[:, None], np.arange(w)[None, :]
    for path in sys.argv[2:]:
        do = gdal.Open(path)
        out = do.GetRasterBand(1).ReadAsArray().astype(np.float64)
        land = land_mask & (out != NOD)
        sea = (~land_mask) & (out != NOD)
        diffs = []
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny = np.clip(ys + dy, 0, h - 1)
            nx = np.clip(xs + dx, 0, w - 1)
            ok = land & sea[ny, nx]
            if ok.any():
                diffs.append(out[ny, nx][ok] - out[ok])  # 海 − 陆
        d = np.concatenate(diffs)
        print(
            "%s\n  n=%d 中位 %+.2f P5 %+.2f P25 %+.2f P75 %+.2f P95 %+.2f"
            % (
                path,
                len(d),
                np.median(d),
                np.percentile(d, 5),
                np.percentile(d, 25),
                np.percentile(d, 75),
                np.percentile(d, 95),
            )
        )
    return 0


if __name__ == '__main__':
    sys.exit(main())
