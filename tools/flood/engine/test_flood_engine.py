"""flood_engine.py 永久水体种子的行为断言（pytest）。

钉三件事：
  ① 无测深 DEM（陆地填洼版，海=NoData）：逐像素保持旧行为——把有效 0 值也当种子，
     test_land_only_* 必红；
  ② 含测深 DEM 且全图无 NoData（未来换源形态）：没有开海锚点时仍能连通演算——
     删掉 water_source_mask 的 dem<=0 分支，test_full_bathy_* 必红；
  ③ 含测深 DEM 且有 NoData 锚点：只认与开海连通的 dem<=0 分量，被围住的负高程
     养殖塘不得当海源——把条件放宽成"所有 dem<=0"，test_enclosed_pond_* 必红。

纯 numpy/scipy 合成网格，不依赖真实 DEM 与 rasterio 数据集。
运行：backend/algorithm-service/.venv/Scripts/python.exe -m pytest tools/flood/engine/test_flood_engine.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from flood_engine import compute_flood_mask, water_source_mask  # noqa: E402

NOD = 32767.0


def _legacy_mask(dem: np.ndarray, nodata: float, level: float) -> np.ndarray:
    """旧实现（只拿 NoData 当海）——仅用作阳性对照。"""
    from scipy import ndimage

    struct8 = np.ones((3, 3), dtype=bool)
    nodata_mask = (dem == nodata) | np.isnan(dem)
    flooded = (dem <= level) & ~nodata_mask
    if not flooded.any():
        return np.zeros_like(dem, dtype=bool)
    labels, _ = ndimage.label(flooded | nodata_mask, structure=struct8)
    sea = np.unique(labels[nodata_mask])
    sea = sea[sea > 0]
    if sea.size == 0:
        return np.zeros_like(dem, dtype=bool)
    return np.isin(labels, sea) & flooded


def test_full_bathy_dem_without_nodata_still_floods_shore():
    """全填充测深 DEM（无 NoData）：旧实现零输出；新实现必须靠 dem<=0 种子连通。"""
    dem = np.array(
        [
            [-10.0, -10.0, -10.0, 0.5, 5.0, 5.0],
            [-10.0, -10.0, -10.0, 0.5, 5.0, 5.0],
            [-10.0, -10.0, -10.0, 0.5, 5.0, 5.0],
        ]
    )
    mask = compute_flood_mask(dem, NOD, level=1.0)
    out = mask & (dem > 0)
    assert out[:, 3].all(), "岸线 0.5m 必须被淹（无 NoData 时靠 dem<=0 种子连通）"
    assert not out[:, 4:].any(), "内陆 5m 不得被淹"
    assert not out[:, 0:3].any(), "深水不进入 '被淹陆地' 输出（land 过滤在 run_online_flood）"
    # 阳性对照：旧实现在此网格上完全无种子 ⇒ 零输出；确认本用例可红
    assert not _legacy_mask(dem, NOD, level=1.0).any()


def test_enclosed_pond_behind_dike_is_not_water_source():
    """有 NoData 锚点时，与开海不连通的负高程塘不得当海源（否则淹没会被高估）。"""
    dem = np.array(
        [
            [NOD, NOD, -0.5, 1.0, 5.0, 5.0, 5.0],
            [NOD, NOD, -0.5, 0.5, 5.0, 0.5, 5.0],
            [NOD, NOD, 5.0, 5.0, 5.0, 5.0, 5.0],
            [5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
            [5.0, 5.0, 5.0, 5.0, -5.0, 5.0, 5.0],
            [5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
        ]
    )
    mask = compute_flood_mask(dem, NOD, level=1.0)
    out = mask & (dem > 0)
    # 开海岸线 0.5~1.0m 低地：被淹
    assert out[0, 3] and out[1, 3]
    # 坝后低位（0.5m，[1,5]）不连通开海：不得被淹
    assert not out[1, 5], "坝后 0.5m 土地不得被围住的塘当作海源而淹没"
    src = water_source_mask(dem, NOD)
    assert not src[4, 4], "被围住的 -5m 塘不得进入永久水体种子"
    assert src[0, 0] and src[0, 2], "开海锚点与连通浅水必须在种子里"


def test_land_only_dem_keeps_legacy_behavior_bitwise():
    """陆地填洼版（无负值像元）：新实现必须与旧实现逐像素一致。"""
    dem = np.array(
        [
            [NOD, NOD, 0.5, 0.5, 5.0],
            [NOD, NOD, 0.0, 0.5, 5.0],
            [NOD, NOD, 5.0, 5.0, 5.0],
        ]
    )
    for level in (0.5, 1.0, 3.0):
        new = compute_flood_mask(dem, NOD, level)
        old = _legacy_mask(dem, NOD, level)
        assert np.array_equal(new, old), f"level={level} 陆地 DEM 行为不得变化"
    # 无负值 ⇒ 种子严格等于 NoData（有效 0 值不是水体）
    assert np.array_equal(water_source_mask(dem, NOD), dem == NOD)


def test_land_only_enclosed_zero_is_not_water_source():
    """陆地 DEM 里被高地围住的有效 0 值（如掩膜填充）不得当海源。"""
    dem = np.array(
        [
            [NOD, 0.3, 0.3, 5.0],
            [5.0, 5.0, 5.0, 5.0],
            [5.0, 0.0, 5.0, 5.0],
            [5.0, 5.0, 5.0, 5.0],
        ]
    )
    mask = compute_flood_mask(dem, NOD, level=0.5)
    assert mask[0, 1] and mask[0, 2], "与海连通的 0.3m 低地应被淹"
    assert not mask[2, 1], "被 5m 高地围住的有效 0 值不是海源，不得被淹"


def test_bathy_enclosed_depression_above_level_not_flooded():
    """含测深 DEM：内陆闭合洼地（高于水位）不淹。"""
    dem = np.array(
        [
            [NOD, -5.0, 1.0, 5.0, 3.0, 5.0],
            [NOD, -5.0, 1.0, 5.0, 3.0, 5.0],
            [NOD, -5.0, 1.0, 5.0, 5.0, 5.0],
        ]
    )
    mask = compute_flood_mask(dem, NOD, level=1.5)
    assert mask[:, 2].all(), "岸线 1.0m 在 1.5m 水位下应被淹"
    assert not mask[:, 4].any(), "内陆闭合洼地 3.0m 与海不连通，不得被淹"


def test_monotonic_in_level_on_bathy_grid():
    dem = np.array(
        [
            [NOD, -10.0, -10.0, -10.0, 0.5, 2.0, 5.0],
            [NOD, -10.0, -10.0, -10.0, 0.5, 2.0, 5.0],
            [NOD, -10.0, -10.0, -10.0, 0.5, 2.0, 5.0],
        ]
    )
    low = compute_flood_mask(dem, NOD, level=1.0)
    high = compute_flood_mask(dem, NOD, level=3.0)
    assert np.all(high >= low), "淹没范围随水位单调不减"


def test_generation_chain_paths_anchor_repo_root():
    """2026-09-26 目录搬迁回归：DEM/waterLevel/251 档输出必须锚在仓库根下。

    parents[1] 曾把三者解析到 tools/flood/data/...（不存在）——把锚点改回去，本用例必红。
    """
    import flood_engine as fe
    import precompute_levels as pl

    repo = Path(fe.__file__).resolve().parents[3]
    assert fe.REPO_ROOT == repo
    assert fe._WATER_LEVEL_JSON == repo / "backend" / "data" / "flood" / "waterLevel.json"
    assert fe._WATER_LEVEL_JSON.exists(), "waterLevel.json 必须能被 datum_offset 读到"
    assert pl.OUT_PATH == repo / "backend" / "data" / "flood" / "flood_levels.json.gz"
    assert "/tools/flood/data/" not in str(fe.DEM_PATH).replace("\\", "/"), (
        "DEM 解析不得再落到 tools/flood/data/（搬迁回归形态）"
    )
