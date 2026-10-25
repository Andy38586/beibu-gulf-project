# -*- coding: utf-8 -*-
"""bilinear.py — 仿射浮点行列坐标上的双线性采样（10 / 11 共用，numpy-only）。

为什么单源（台账 F75）：10-landsea-merge 与 11-seam-audit 各自手抄同一段
「clip(floor(fr/fc)) → 四角取数 → 任一角 NaN 即 ok=False → 双线性加权」。两处只有
分块行数（800 / 1500）与下游用途不同；10 另有最近邻兜底（near_ok），那是它自己的口径，
不在本模块内。06-sea-mask 只做最近邻（无插值），不属本变体。

为什么单独成文件、不并入 tile_sample.py：10/11 跑在 QGIS 自带 python（有 osgeo、无
rasterio），tile_sample 依赖 rasterio，不能共用同一模块。

判据见 test_bilinear.py：与旧内联实现逐位相等（含 NaN 角、越界裁剪、整幅/单点）。
"""
from __future__ import annotations

import numpy as np


def bilinear_sample(sea: np.ndarray, fr: np.ndarray, fc: np.ndarray):
    """在 sea（H×W，可含 NaN）上按浮点行列坐标 fr/fc 采样。

    返回 (bil, ok)：
      · bil：双线性插值值（dtype 随 numpy 提升，float32 源 → float64）；
      · ok：四角全部非 NaN 才为 True（缺角不猜值，由调用方决定兜底/跳过）。

    索引与插值顺序与旧内联实现逐字一致（先 clip 到 0..h-2 / 0..w-2，再取 fx/fy）。
    """
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
