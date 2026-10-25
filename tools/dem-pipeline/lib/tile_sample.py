# -*- coding: utf-8 -*-
"""tile_sample.py — 瓦片窗口几何 + DEM 采样到 heightmap 网格的单一源（07 / 07c 共用）。

为什么单源（台账 F74）：07（全量重切）与 07c（枢纽补切）各自手抄同一段
「瓦片 SAMPLES 网格 ↔ DEM 范围求交 → from_bounds 窗口 → 双线性读 → nodata/非有限补 0」。
两处只有变量名与 nodata 缺省值不同；07c 还把掩膜从整幅挪进了窗口内 —— 语义等价
（窗口外恒 0，掩膜对 0 是恒等），但两份代码之间再无共同真值，改一处不会带动另一处。

判据见 test_tile_sample.py：在整幅覆盖 / 部分相交 / 完全不相交 / DEM 贴边四类窗口上，
把本模块与旧内联算法对拍，要求逐位相等；07 / 07c 的产物字节比对见 .local/math-report.md。
"""
from __future__ import annotations

import math

import numpy as np
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

from terrain_enc import SAMPLES


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Cesium GeographicTilingScheme：z 级 2^(z+1) 列 × 2^z 行，y=0 最北。

    返回 (lon_w, lat_s, lon_e, lat_n)。
    """
    cols = 2 ** (z + 1)
    rows = 2**z
    lon_w = -180.0 + x * 360.0 / cols
    lon_e = -180.0 + (x + 1) * 360.0 / cols
    lat_n = 90.0 - y * 180.0 / rows
    lat_s = 90.0 - (y + 1) * 180.0 / rows
    return lon_w, lat_s, lon_e, lat_n


def reslice_tile(dem, bounds: tuple[float, float, float, float], nodata: float) -> np.ndarray:
    """把 dem 采样到瓦片 SAMPLES×SAMPLES 网格（float64，米）。

    与 DEM 范围求交后按双线性重采样（WarpedVRT 不支持 boundless，越界不读，留 0 高程
    = 海洋）；nodata / 非有限值同样记 0 高程。掩膜只作用在相交窗口内 —— 窗口外恒为
    已置 0 的初值，掩膜对 0 是恒等，故与「整幅掩膜」逐位等价。
    """
    lon_w, lat_s, lon_e, lat_n = bounds
    grid = np.zeros((SAMPLES, SAMPLES), dtype=np.float64)
    step_lat = (lat_n - lat_s) / (SAMPLES - 1)
    step_lon = (lon_e - lon_w) / (SAMPLES - 1)
    dem_bounds = dem.bounds
    j0 = max(0, math.ceil((dem_bounds.left - lon_w) / step_lon))
    j1 = min(SAMPLES - 1, math.floor((dem_bounds.right - lon_w) / step_lon))
    i0 = max(0, math.ceil((lat_n - dem_bounds.top) / step_lat))
    i1 = min(SAMPLES - 1, math.floor((lat_n - dem_bounds.bottom) / step_lat))
    if j1 < j0 or i1 < i0:
        return grid
    win = from_bounds(
        lon_w + j0 * step_lon,
        lat_n - i1 * step_lat,
        lon_w + j1 * step_lon,
        lat_n - i0 * step_lat,
        transform=dem.transform,
    )
    sub = dem.read(
        1,
        window=win,
        out_shape=(i1 - i0 + 1, j1 - j0 + 1),
        resampling=Resampling.bilinear,
    ).astype(np.float64)
    grid[i0 : i1 + 1, j0 : j1 + 1] = np.where(
        (sub == nodata) | ~np.isfinite(sub), 0.0, sub
    )
    return grid
