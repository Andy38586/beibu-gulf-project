# -*- coding: utf-8 -*-
"""probe-mask-diff-cells.py — 两代海陆掩膜差异的聚合格影响面（只读）。

用法（QGIS python）：
  python probe-mask-diff-cells.py <OLD_CUT.tif> <NEW_CUT.tif> [block=16]

两 cut 的 nodata（32767）= 海；统计像元类别变化与按 block×block（默认 16 px
= 480m）聚合后受影响的含陆格数/占比。用于回答"掩膜换代后哪些下游聚合产物需重派生"。
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
    block = int(sys.argv[3]) if len(sys.argv) > 3 else 16
    d_old = gdal.Open(sys.argv[1])
    old = d_old.GetRasterBand(1).ReadAsArray()
    d_new = gdal.Open(sys.argv[2])
    new = d_new.GetRasterBand(1).ReadAsArray()
    if old.shape != new.shape:
        print('两 cut 网格不一致: %s vs %s' % (old.shape, new.shape))
        return 2
    old_sea, new_sea = old == NOD, new == NOD
    changed = old_sea != new_sea
    h, w = changed.shape
    hb, wb = h // block, w // block
    sl = (slice(0, hb * block), slice(0, wb * block))
    red = lambda m: m[sl].reshape(hb, block, wb, block).any(axis=(1, 3))
    affected = red(changed)
    land_any = red(~old_sea) | red(~new_sea)
    n_land = int(land_any.sum())
    n_aff = int((affected & land_any).sum())
    print(
        '变化像元=%d（%.2f%%；海→陆 %d / 陆→海 %d）'
        % (
            changed.sum(),
            100.0 * changed.sum() / changed.size,
            (old_sea & ~new_sea).sum(),
            (~old_sea & new_sea).sum(),
        )
    )
    print(
        '%dpx 格总数=%d；任一代含陆=%d；受影响含陆格=%d（%.2f%%）'
        % (block, affected.size, n_land, n_aff, 100.0 * n_aff / max(1, n_land))
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
