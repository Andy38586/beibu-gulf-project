"""06-sea-mask.py 的三条判据断言（pytest）。

规则（2026-10-04 定型）：海 = 海岸线判据 ∩ 测深源判据(bathy<=0 或无值) ∩ 源DEM不判陆(dem<=0)。
  · 删掉测深确认 ⇒ test_bathy_clause_* 必红；
  · 把交集写成并集 ⇒ test_coast_clause_* 必红；
  · 丢掉"测深无值"分支 ⇒ test_nan_clause_* 必红；
  · 把 <=0 写成 <0（同义违约换边界记法）⇒ test_zero_band_* 必红；
  · 丢掉第三条（源 DEM 判陆）⇒ test_source_land_* 必红；
  · 等价重构（np.where 写法 / 显式循环）不许红。

全部是 4326 合成的 40×40 小栅格（落在工具自己的 BOX 内），不依赖真实数据。
运行：backend/algorithm-service/.venv/Scripts/python.exe -m pytest tools/dem-pipeline/test_sea_mask.py -q
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

MODULE_PATH = Path(__file__).resolve().parent / "06-sea-mask.py"
NOD = 32767
W = H = 40
LON0, LAT0, CELL = 108.0, 22.0, 0.001
# 海岸线判据用「行角点 northing < 岸线纬度」：行 k 角点 = 22.0 - 0.001k。
# 21.9805 落在第 19/20 行之间 → 第 20 行起判海（留 0.5 格防浮点误差）。
COAST_LAT = 21.9805
TRANSFORM = from_origin(LON0, LAT0, CELL, CELL)

NORTH_FLAT = 2  # 行 0~2：源 DEM 为 0 的北侧低地（海岸线判陆、测深判海 → 取交集必须判陆）
WHARF_ROW = H - 8  # 源 DEM 判陆的小码头（测深看不见）


def _load_module():
    spec = importlib.util.spec_from_file_location("sea_mask_mod", MODULE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _write(path: Path, arr: np.ndarray, nodata=None) -> Path:
    kw = {} if nodata is None else {"nodata": nodata}
    with rasterio.open(
        path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1],
        count=1, dtype=arr.dtype, crs="EPSG:4326", transform=TRANSFORM, **kw
    ) as dst:
        dst.write(arr, 1)
    return path


@pytest.fixture()
def scene(tmp_path):
    """源 DEM（ASTER 形态）+ 测深源（SRTM15+ 形态）：

    src 行 0~2   = 0   北侧低地（海岸线判陆 / 测深判海）
    src 行 3~19  = 10  陆上
    src 行 20~39 = 0   海岸线判海；其中西段 10 列是**被误吞的真陆地**
    bathy 行 0~2 = -3 ；行 3~19 = +6
         行 20~39：西 10 列 +5（真陆地）、次 5 列 +7、再 5 列 0.0、其余 -8
    """
    src = np.full((H, W), 10, dtype=np.int16)
    src[: NORTH_FLAT + 1, :] = 0
    src[H // 2 :, :] = 0
    src[H // 2 :, : W // 4] = 10
    src[WHARF_ROW : WHARF_ROW + 3, W - 6 : W - 3] = 4  # 窄码头
    src_path = _write(tmp_path / "aster.tif", src, NOD)

    bathy = np.full((H, W), -8.0, dtype=np.float32)
    bathy[: NORTH_FLAT + 1, :] = -3.0
    bathy[NORTH_FLAT + 1 : H // 2, :] = 6.0
    bathy[H // 2 :, : W // 4] = 5.0
    bathy[H // 2 :, W // 4 : W // 4 + 5] = 7.0
    bathy[H // 2 :, W // 4 + 5 : W // 2] = 0.0
    bathy[2, 2] = np.nan  # 源覆盖外的无值点（北侧）
    bathy_path = _write(tmp_path / "bathy.tif", bathy)

    coast = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [LON0 - 0.01, COAST_LAT],
                        [LON0 + W * CELL + 0.01, COAST_LAT],
                    ],
                },
            }
        ],
    }
    coast_path = tmp_path / "coast.geojson"
    coast_path.write_text(json.dumps(coast), encoding="utf-8")
    return {"src": src_path, "bathy": bathy_path, "coast": coast_path, "dir": tmp_path}


def _run(mod, scene, out_name, with_bathy=True):
    out = scene["dir"] / out_name
    argv = ["06-sea-mask.py", str(scene["src"]), str(out), str(scene["coast"])]
    if with_bathy:
        argv.append(str(scene["bathy"]))
    old = sys.argv
    sys.argv = argv
    try:
        mod.main()
    finally:
        sys.argv = old
    return rasterio.open(out).read(1)


def test_coast_clause_only_masks_sea_side(scene):
    """无测深源时：南侧判海（除源 DEM 判陆的西段），北侧低地一律保留。"""
    mod = _load_module()
    out = _run(mod, scene, "coast_only.tif", with_bathy=False)
    assert (out[: NORTH_FLAT + 1, :] == 0).all(), "北侧 0m 低地被误判成海"
    assert (out[NORTH_FLAT + 1 : H // 2, :] == 10).all()
    assert (out[H // 2 :, W // 4 : W - 6] == NOD).all()


def test_bathy_clause_restores_masked_land(scene):
    """加测深确认后：测深判陆的南侧条带（源 DEM 为 0）从海掩膜里取回。"""
    mod = _load_module()
    out = _run(mod, scene, "full.tif")
    assert (out[: NORTH_FLAT + 1, :] == 0).all()
    assert (out[H // 2 :, : W // 4] == 10).all()
    assert (out[H // 2 :, W // 4 : W // 4 + 5] == 0).all(), "测深判陆的条带未被取回"
    assert (out[H // 2 :, W // 4 + 5 : W - 6] == NOD).all()


def test_zero_band_counts_as_sea(scene):
    """测深值恰为 0 的条带必须仍判海（边界记法：<=0，不是 <0）。"""
    mod = _load_module()
    out = _run(mod, scene, "zero.tif")
    assert (out[H // 2 :, W // 4 + 5 : W // 2] == NOD).all()


def test_nan_clause_keeps_coast_verdict(scene):
    """测深无值处沿用海岸线判据：北侧留陆、南侧仍判海。"""
    mod = _load_module()
    out = _run(mod, scene, "nan.tif")
    assert out[2, 2] == 0, "无值点被当成海"
    with rasterio.open(str(scene["bathy"]), "r+") as ds:
        ds.write(
            np.full((1, 1), np.nan, dtype=np.float32),
            1,
            window=rasterio.windows.Window(W // 2 + 1, H // 2 + 1, 1, 1),
        )
    out2 = _run(mod, scene, "nan2.tif")
    assert out2[H // 2 + 1, W // 2 + 1] == NOD, "南侧无值点被判成陆"


def test_source_land_clause_keeps_wharf(scene):
    """第三条：源 DEM 判陆的窄码头，即使海岸线+测深都判海也必须保留。"""
    mod = _load_module()
    out = _run(mod, scene, "wharf.tif")
    assert (out[WHARF_ROW : WHARF_ROW + 3, W - 6 : W - 3] == 4).all(), "码头被抹成水深"
    # 同排、源 DEM 仍为 0 的邻居照旧判海（不是整片放开）
    assert (out[WHARF_ROW : WHARF_ROW + 3, W - 12 : W - 9] == NOD).all()
