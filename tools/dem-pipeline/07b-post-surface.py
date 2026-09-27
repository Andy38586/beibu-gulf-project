#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""07b —— 生成「工程后地表」栅格（只挖不填）。

背景（2026-09-27）：平陆运河三枢纽现在是**已建成**状态，而 07-heightmap-reslice 用的
GLO-30 是工程前地表（分水岭地带是山）。不处理的话，按真实设计水位落位的枢纽模型
会整体埋进山里（实测马道埋 50.9 m、青年 38.0 m）。

做法：工程后地表 = min(工程前 DEM, 设计开挖面)，设计开挖面 = 渠槽（渠底 = 设计水位
      − 门槛水深 8 m、底宽 80 m、1:2 边坡）+ 枢纽平台（半宽按正射实测）。
**只减不增**，物理上不会把地形抬高。

输入：`.local/dem-work/filled_utm48n_cut.tif`（与 07-heightmap-reslice 同源）
输出：`post_surface_utm48n.tif` → 交给 07c 重切

⚠ 原始 DEM 只读，不修改。
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.warp import transform as warp_transform
from rasterio.windows import from_bounds

REPO = Path(r"C:\workspace\beibu-gulf-project")
OUT = REPO / ".local/926-rebake"
DEM = REPO / ".local/dem-work/filled_utm48n_cut.tif"
ANCHOR = (108.8300, 22.2000)

# 与方案一致：设计水位（正高）/ 航道参数
# 开挖范围按**正射实测工地尺寸**（2026-09-27 量）：
#   马道 2192x611 / 企石 1803x698 / 青年 1670x584 m（5-95 分位）
HUBS = {
    "madao":    {"lon": 108.93922, "lat": 22.44632, "bearing": 198.0,
                 "up_wl": 62.30, "dn_wl": 32.70, "x0": -1478.0, "x1": 801.0, "half_w": 305.0},
    "qishi":    {"lon": 108.94146, "lat": 22.32265, "bearing": 182.0,
                 "up_wl": 35.00, "dn_wl": 8.70, "x0": -687.0, "x1": 1003.0, "half_w": 349.0},
    "qingnian": {"lon": 108.65500, "lat": 22.01020, "bearing": 190.0,
                 "up_wl": 8.70, "dn_wl": -1.62, "x0": -438.0, "x1": 817.0, "half_w": 292.0},
}
CH_W = 80.0        # 渠底宽（假设）
DRAFT = 8.0        # 门槛水深（公开值）
SLOPE = 2.0        # 1:2（假设）
PLAT_HALF = 300.0  # 枢纽平台半宽（容纳省水池/泄水闸/电站/场坪，按正射工地范围假设）
PLAT_RISE = 12.0   # 平台面高于上游水位的高差（马道 62.3+12=74.3 ≈ 公开坝顶 73.5）
X_UP, X_LOCK0, X_LOCK1, X_DN = -963.0, 0.0, 400.0, 1055.0   # 与白模同参
TAPER = 260.0      # 上游渠底过渡段长（示意图）


def main():
    with rasterio.open(DEM) as src:
        crs, tr = src.crs, src.transform
        W, H = src.width, src.height
        arr = src.read(1).astype(np.float64)
        nodata = src.nodata if src.nodata is not None else 32767.0
        prof = src.profile.copy()
    valid = (arr != nodata) & np.isfinite(arr)
    post = arr.copy()

    rows, cols = np.mgrid[0:H, 0:W]
    xs, ys = rasterio.transform.xy(tr, rows.ravel(), cols.ravel(), offset="center")
    xs = np.asarray(xs).reshape(H, W)
    ys = np.asarray(ys).reshape(H, W)

    report = {}
    mlon = 111412.84 * math.cos(math.radians(22.2))
    mlat = 111132.9
    for hub, c in HUBS.items():
        # 锚点 UTM
        ex, ny = warp_transform("EPSG:4326", crs, [c["lon"]], [c["lat"]])
        ax, ay = ex[0], ny[0]
        br = math.radians(c["bearing"])
        # 局部轴：+X 下游；横向 d
        dx = xs - ax
        dy = ys - ay
        # UTM 北向/东向 → 沿轴分量：下游方向单位向量（东,北）= (sin b, cos b)
        s = dx * math.sin(br) + dy * math.cos(br)
        d = dx * math.cos(br) - dy * math.sin(br)
        # 只处理模型范围外扩 400 m 的窗口，省算力
        PLAT_HALF = c["half_w"]      # 逐枢纽平台半宽（正射实测）
        m = (s > c["x0"] - 200) & (s < c["x1"] + 200) & (np.abs(d) < PLAT_HALF + 900)
        if not m.any():
            print(f"[{hub}] 窗口为空，跳过"); continue
        # 渠底分段：上游 → 闸室 → 下游（上游段设过渡）
        bot_up = c["up_wl"] - DRAFT
        bot_dn = c["dn_wl"] - DRAFT
        t = np.clip((s - (X_LOCK0 - TAPER)) / TAPER, 0.0, 1.0)
        bot = bot_up * (1 - t) + bot_dn * t
        bot = np.where(s >= X_LOCK0, bot_dn, bot)
        # 开挖面 = 渠槽 → 平台 → 1:2 边坡与原地形相接
        plat = max(c["up_wl"], c["dn_wl"]) + PLAT_RISE
        ad = np.abs(d)
        ramp = np.where(ad <= CH_W / 2, bot,
                        np.where(ad <= PLAT_HALF, plat,
                                 plat + (ad - PLAT_HALF) / SLOPE))
        carve = np.minimum(post, ramp)
        # 渠底强制（|d| < 渠底宽/2）：保证渠槽存在
        carve = np.where(ad < CH_W / 2, bot, carve)
        # 平台面强制（渠边 → 平台半宽）：保证工地平台存在（只在下挖意义下）
        carve = np.where((ad >= CH_W / 2) & (ad < PLAT_HALF),
                         np.minimum(carve, plat), carve)
        newv = np.where(m, carve, post)
        cut = np.maximum(0.0, post - newv)
        cut[~m] = 0.0
        n_cut = int((cut > 0.5).sum())
        report[hub] = {"max_cut_m": float(cut.max()), "cells_cut": n_cut,
                       "bot_up": bot_up, "bot_dn": bot_dn,
                       "area_km2": n_cut * 900.0 / 1e6}
        print(f"[{hub}] 渠底 上游 {bot_up:6.2f} / 下游 {bot_dn:6.2f} m | "
              f"最大挖深 {cut.max():6.1f} m | 挖方像元 {n_cut:7d}（≈{report[hub]['area_km2']:.2f} km²）")
        post = newv

    out = OUT / "post_surface_utm48n.tif"
    prof.update(dtype="int16", nodata=-32768, compress="deflate")
    with rasterio.open(out, "w", **prof) as dst:
        o = np.where(valid, np.round(post), -32768).astype("int16")
        dst.write(o, 1)
    print(f"\n-> {out}  ({out.stat().st_size/1e6:.1f} MB)")
    (OUT / "post-surface-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
