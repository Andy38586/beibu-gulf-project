# -*- coding: utf-8 -*-
"""bilinear 单源判据（pytest）。

背景（台账 F75）：10-landsea-merge 与 11-seam-audit 曾各自手抄同一段「四角取样 + NaN
缺角 + 双线性加权」。本文件把旧内联实现原样留作对照（legacy_bilinear），要求
lib/bilinear.py 在下列输入上与之**逐位相等**（含 NaN 位置与 NaN 值）：

  · 规则网格（10 的 (n,1)×(1,W) 广播形态）
  · 全宽形态（11 的 (n,W)×(n,W)）
  · 越界坐标（fr/fc 远小于 0 / 远大于尺寸 ⇒ clip 到 0 与 h-2）
  · NaN 缺角（角点含 NaN ⇒ ok=False，且 bil 的 NaN 位置必须一致）
  · 单行/单列（n=1，验广播不被压扁）

任一处改掉 clip 边界、索引顺序或加权顺序 ⇒ 本文件必红。
运行：backend/algorithm-service/.venv/Scripts/python.exe -m pytest tools/dem-pipeline/test_bilinear.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "dem-pipeline" / "lib"))
import bilinear as bl  # noqa: E402


def legacy_bilinear(sea: np.ndarray, fr: np.ndarray, fc: np.ndarray):
    """10/11 旧内联实现（9a95f140 原文）。"""
    sh, sw = sea.shape
    i0 = np.clip(np.floor(fr).astype(np.int64), 0, sh - 2)
    j0 = np.clip(np.floor(fc).astype(np.int64), 0, sw - 2)
    fy = fr - i0
    fx = fc - j0
    p00 = sea[i0, j0]
    p01 = sea[i0, j0 + 1]
    p10 = sea[i0 + 1, j0]
    p11 = sea[i0 + 1, j0 + 1]
    ok = ~np.isnan(p00) & ~np.isnan(p01) & ~np.isnan(p10) & ~np.isnan(p11)
    bil = (p00 * (1 - fx) + p01 * fx) * (1 - fy) + (p10 * (1 - fx) + p11 * fx) * fy
    return bil, ok


@pytest.fixture(scope="module")
def sea() -> np.ndarray:
    rng = np.random.default_rng(20261026)
    a = rng.normal(0.0, 120.0, size=(97, 63)).astype(np.float32)
    a[5:9, 7:11] = np.nan  # 2×2 以上的 NaN 块（必有角点命中）
    a[::13, ::11] = np.nan  # 稀疏 NaN
    return a


def _assert_same(got, want, label: str):
    bil_g, ok_g = got
    bil_w, ok_w = want
    assert bil_g.shape == bil_w.shape, f"{label}: shape"
    assert bil_g.dtype == bil_w.dtype, f"{label}: dtype {bil_g.dtype} != {bil_w.dtype}"
    assert np.array_equal(ok_g, ok_w), f"{label}: ok 掩膜不一致"
    assert np.array_equal(bil_g, bil_w, equal_nan=True), f"{label}: 插值不一致"


@pytest.mark.parametrize("n", [1, 7, 33])
def test_broadcast_form_matches_legacy(sea: np.ndarray, n: int):
    """10 的形态：fr=(n,1)、fc=(1,W)。"""
    rng = np.random.default_rng(n)
    fr = rng.uniform(-5.0, sea.shape[0] + 5.0, size=(n, 1))
    fc = rng.uniform(-5.0, sea.shape[1] + 5.0, size=(1, sea.shape[1]))
    _assert_same(bl.bilinear_sample(sea, fr, fc), legacy_bilinear(sea, fr, fc), f"broadcast n={n}")


@pytest.mark.parametrize("n", [1, 5, 41])
def test_full_form_matches_legacy(sea: np.ndarray, n: int):
    """11 的形态：fr/fc 都是 (n,W)，且行带不连续（分块起点任意）。"""
    rng = np.random.default_rng(100 + n)
    fr = rng.uniform(-3.0, sea.shape[0] + 3.0, size=(n, sea.shape[1]))
    fc = rng.uniform(-3.0, sea.shape[1] + 3.0, size=(n, sea.shape[1]))
    _assert_same(bl.bilinear_sample(sea, fr, fc), legacy_bilinear(sea, fr, fc), f"full n={n}")


def test_extreme_bounds_clip_to_edges(sea: np.ndarray):
    """远越界：fr/fc 取 -1e6 / +1e6，必须 clip 到 0 与 h-2/w-2，不得 IndexError。"""
    fr = np.array([[-1e6], [1e6], [0.0]])
    fc = np.array([[-1e6, 1e6, 0.0]])
    got = bl.bilinear_sample(sea, fr, fc)
    want = legacy_bilinear(sea, fr, fc)
    _assert_same(got, want, "extreme")


def test_nan_corner_is_not_ok(sea: np.ndarray):
    """命中 NaN 块左上角 ⇒ ok=False（且 bil 为 NaN），与旧实现一致。"""
    fr = np.array([[5.0]])  # 落在 (5,7) NaN 块
    fc = np.array([[7.0]])
    bil, ok = bl.bilinear_sample(sea, fr, fc)
    assert not bool(ok[0, 0])
    assert np.isnan(bil[0, 0])
    _assert_same((bil, ok), legacy_bilinear(sea, fr, fc), "nan-corner")


def test_no_nan_in_output_when_all_corners_valid(sea: np.ndarray):
    """ok=True 处不得出现 NaN（旧实现同款）。"""
    fr = np.arange(40, 43, dtype=np.float64).reshape(-1, 1)
    fc = np.arange(20, 23, dtype=np.float64).reshape(1, -1)
    bil, ok = bl.bilinear_sample(sea, fr, fc)
    assert ok.all()
    assert np.isfinite(bil).all()
