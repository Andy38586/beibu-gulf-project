# -*- coding: utf-8 -*-
"""07b-post-surface 基准判别的判据（pytest，跑在 dem-pipeline venv）。

钉的是 2026-10-05 统一基准后 07b 的水位换算跟随规则（修复前缺陷：--dem 默认 EGM96 件
而 --grid 存在即换算，默认组合产出「EGM96 地表被椭球水位雕刻」的静默错位地表）：
  - 椭球件（*_ell.tif）+ grid 可用 ⇒ shift（现役地形链）；
  - EGM96 件 ⇒ 永不 shift（grid 被忽略，正高自洽链）；
  - 椭球件缺 grid ⇒ ValueError（fail-loud，不出错件）；
  - 缺省 DEM 解析：椭球件存在则优先，缺失回退 EGM96 件。
夹具全部用临时路径名，不与任何生产数据同值。
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'tools' / 'dem-pipeline' / '07b-post-surface.py'


def load_module():
    spec = importlib.util.spec_from_file_location('post_surface', SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ELL = Path('filled_utm48n_cut_ell.tif')
EGM = Path('filled_utm48n_cut.tif')


def test_ell_dem_with_grid_shifts():
    """椭球件 + grid ⇒ 换算（现役链）。"""
    mod = load_module()
    assert mod.plan_level_shift(ELL, True) == 'shift'


def test_egm96_dem_with_grid_skips():
    """EGM96 件 + grid 存在 ⇒ 不换算（修复前的违约形态：grid 存在即换算 ⇒ 此例必红）。"""
    mod = load_module()
    assert mod.plan_level_shift(EGM, True) == 'skip'


def test_egm96_dem_without_grid_skips():
    """EGM96 件 + grid 缺失 ⇒ 不换算（旧正高链，自洽）。"""
    mod = load_module()
    assert mod.plan_level_shift(EGM, False) == 'skip'


def test_ell_dem_without_grid_fails_loud():
    """椭球件缺 grid ⇒ ValueError（停用 fail-loud 即回到静默错位 ⇒ 此例必红）。"""
    mod = load_module()
    with pytest.raises(ValueError, match='椭球件'):
        mod.plan_level_shift(ELL, False)


def test_datum_kind_follows_ell_suffix():
    """基准判别 = 文件名命名约定（等价记法：stem 判 _ell 子串）。"""
    mod = load_module()
    assert mod.datum_kind(ELL) == 'ell'
    assert mod.datum_kind(EGM) == 'egm96'
    assert mod.datum_kind(Path('sea_custom_ell.tif')) == 'ell'


def test_default_dem_prefers_ell(tmp_path, monkeypatch):
    """缺省解析：椭球件存在则优先；缺失回退 EGM96 件。"""
    mod = load_module()
    ell = tmp_path / 'filled_utm48n_cut_ell.tif'
    egm = tmp_path / 'filled_utm48n_cut.tif'
    ell.write_bytes(b'x')
    monkeypatch.setattr(mod, 'DEM_ELL', ell)
    monkeypatch.setattr(mod, 'DEM', egm)
    assert mod.default_dem() == ell
    ell.unlink()
    assert mod.default_dem() == egm
