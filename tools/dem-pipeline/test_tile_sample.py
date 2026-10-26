# -*- coding: utf-8 -*-
"""tile_sample 单源判据（pytest，跑在 dem-pipeline venv）。

背景（台账 F74）：07（全量重切）与 07c（枢纽补切）曾各自手抄同一段
「瓦片网格 ↔ DEM 求交 → from_bounds 窗口 → 双线性读 → nodata/非有限补 0」。
本文件把旧内联算法原样留作对照（legacy_reslice / legacy_reslice_window_mask），
要求 lib/tile_sample.py 在四类窗口上与之**逐位相等**：

  · 整幅覆盖（z0 根瓦片，网格步长远大于 DEM 范围 ⇒ 只落一个采样点）
  · 部分相交（z10/z12，正常重采样）
  · 完全不相交（DEM 之外 ⇒ 全 0，不得读窗口）
  · DEM 贴边（东西/南北边界裁剪，i0/i1/j0/j1 收口到 0 / SAMPLES-1）

任一处把窗口算式、nodata 掩膜或 dtype 改掉 ⇒ 本文件必红。
运行：backend/algorithm-service/.venv/Scripts/python.exe -m pytest tools/dem-pipeline/test_tile_sample.py -q
"""
from __future__ import annotations

import ast
import math
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "dem-pipeline" / "lib"))
import tile_sample as ts  # noqa: E402

NODATA = -32767.0
LON0, LAT0, RES = 108.90, 22.50, 0.002
W, H = 300, 200


@pytest.fixture(scope="module")
def dem_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """带 nodata 块 / 孤立 nodata 像元 / NaN 的 4326 小 DEM（覆盖 108.90~109.50E, 22.10~22.50N）。"""
    y, x = np.mgrid[0:H, 0:W]
    z = (120.0 * np.sin(x / 17.0) * np.cos(y / 11.0) + 0.35 * x + 0.2 * y).astype(np.float32)
    z[10:40, 20:60] = NODATA
    z[::29, ::31] = NODATA
    z[100:104, 150:154] = np.nan
    p = tmp_path_factory.mktemp("tile-sample") / "dem.tif"
    with rasterio.open(
        p,
        "w",
        driver="GTiff",
        height=H,
        width=W,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_origin(LON0, LAT0, RES, RES),
        nodata=NODATA,
    ) as d:
        d.write(z, 1)
    return p


def legacy_reslice(dem, bounds, nodata, samples: int = ts.SAMPLES) -> np.ndarray:
    """07-heightmap-reslice.py 旧内联实现（9a95f140 原文，仅把常量换成参数）。"""
    lon_w, lat_s, lon_e, lat_n = bounds
    heights = np.full((samples, samples), 0.0)
    step_lat = (lat_n - lat_s) / (samples - 1)
    step_lon = (lon_e - lon_w) / (samples - 1)
    j0 = max(0, math.ceil((dem.bounds.left - lon_w) / step_lon))
    j1 = min(samples - 1, math.floor((dem.bounds.right - lon_w) / step_lon))
    i0 = max(0, math.ceil((lat_n - dem.bounds.top) / step_lat))
    i1 = min(samples - 1, math.floor((lat_n - dem.bounds.bottom) / step_lat))
    if j1 >= j0 and i1 >= i0:
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
        )
        heights[i0 : i1 + 1, j0 : j1 + 1] = sub
    return np.where(np.isfinite(heights) & (heights != nodata), heights, 0.0)


def legacy_reslice_window_mask(dem, bounds, nodata, samples: int = ts.SAMPLES) -> np.ndarray:
    """07c-patch-terrain.py 旧内联实现（9a95f140 原文）：掩膜只作用在窗口内。"""
    lon_w, lat_s, lon_e, lat_n = bounds
    h = np.zeros((samples, samples))
    sl = (lat_n - lat_s) / (samples - 1)
    so = (lon_e - lon_w) / (samples - 1)
    j0 = max(0, math.ceil((dem.bounds.left - lon_w) / so))
    j1 = min(samples - 1, math.floor((dem.bounds.right - lon_w) / so))
    i0 = max(0, math.ceil((lat_n - dem.bounds.top) / sl))
    i1 = min(samples - 1, math.floor((lat_n - dem.bounds.bottom) / sl))
    if j1 >= j0 and i1 >= i0:
        win = from_bounds(
            lon_w + j0 * so,
            lat_n - i1 * sl,
            lon_w + j1 * so,
            lat_n - i0 * sl,
            transform=dem.transform,
        )
        sub = dem.read(
            1,
            window=win,
            out_shape=(i1 - i0 + 1, j1 - j0 + 1),
            resampling=Resampling.bilinear,
        ).astype(np.float64)
        h[i0 : i1 + 1, j0 : j1 + 1] = np.where((sub == nodata) | ~np.isfinite(sub), 0.0, sub)
    return h


# (z, x, y) 代表四类窗口：z0 全幅、z10 贴边部分相交、z12 内部/邻接、z12 远离 DEM
CASES = [
    (0, 1, 0),  # 整个东半球：DEM 只占 1 个采样点
    (10, 1643, 384),  # DEM 西北角：窗口只与瓦片东南角相交
    (10, 1646, 386),  # DEM 东南角：反向的不全相交
    (12, 6580, 1540),  # DEM 内部（含 nodata 块与 NaN）
    (12, 6581, 1540),  # 邻接上一张（共享边缘，验边缘一致）
    (12, 6500, 1540),  # 完全不相交（DEM 以西）
    (12, 6580, 1450),  # 完全不相交（DEM 以北）
    (8, 410, 96),  # 大范围覆盖（DEM 只占瓦片一角）
]


@pytest.mark.parametrize("zxy", CASES)
def test_reslice_tile_matches_legacy_both_variants(dem_path: Path, zxy: tuple[int, int, int]):
    z, x, y = zxy
    bounds = ts.tile_bounds(z, x, y)
    with rasterio.open(dem_path) as dem:
        got = ts.reslice_tile(dem, bounds, NODATA)
        want_07 = legacy_reslice(dem, bounds, NODATA)
        want_07c = legacy_reslice_window_mask(dem, bounds, NODATA)
    assert got.dtype == np.float64
    assert got.shape == (ts.SAMPLES, ts.SAMPLES)
    # 逐位相等（不是 allclose）：量化前的高程必须一字节不差
    assert np.array_equal(got, want_07), f"{zxy} 与 07 旧实现不一致"
    assert np.array_equal(got, want_07c), f"{zxy} 与 07c 旧实现不一致"


def test_no_overlap_tile_is_zero(dem_path: Path):
    """完全不相交 ⇒ 全 0（海洋记法），且不因越界读窗口抛错。"""
    bounds = ts.tile_bounds(3, 0, 0)
    with rasterio.open(dem_path) as dem:
        got = ts.reslice_tile(dem, bounds, NODATA)
    assert got.shape == (ts.SAMPLES, ts.SAMPLES)
    assert not got.any()


def test_nodata_and_nan_become_zero(dem_path: Path):
    """nodata 块 / NaN 圆心必须落 0，不得产生 -32767 或 nan。"""
    bounds = ts.tile_bounds(11, 3287, 768)  # 覆盖 DEM 中部的 nodata 块
    with rasterio.open(dem_path) as dem:
        got = ts.reslice_tile(dem, bounds, NODATA)
    assert np.isfinite(got).all()
    assert (got != NODATA).all()
    assert (got == 0.0).any()  # nodata 块落成 0 m（海洋记法）
    assert got.min() > -1000.0  # 越界收口后不应残留哨兵值级负高程


def test_tile_bounds_matches_geographic_scheme():
    """z0 根：两张 180°×180°；z1：四列两行；y=0 最北。"""
    assert ts.tile_bounds(0, 0, 0) == (-180.0, -90.0, 0.0, 90.0)
    assert ts.tile_bounds(0, 1, 0) == (0.0, -90.0, 180.0, 90.0)
    assert ts.tile_bounds(1, 2, 1) == (0.0, -90.0, 90.0, 0.0)


def test_scripts_import_modules_they_use():
    """F74 回归：脚本删 import 但保留用法 ⇒ NameError（2026-10-26 07c 的 math 实测）。"""
    scripts = [
        '07-heightmap-reslice.py',
        '07c-patch-terrain.py',
        '10-landsea-merge.py',
        '11-seam-audit.py',
    ]
    watched = {'math', 'np', 'json', 'sys'}
    root = Path(__file__).resolve().parent
    bad = []
    for name in scripts:
        tree = ast.parse((root / name).read_text(encoding='utf-8'))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update((a.asname or a.name).split('.')[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.update(a.asname or a.name for a in node.names)
        used = {
            n.id
            for n in ast.walk(tree)
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)
        }
        missing = sorted((used & watched) - imported)
        if missing:
            bad.append(f'{name}: 使用了未导入的 {missing}')
    assert not bad, '；'.join(bad)
