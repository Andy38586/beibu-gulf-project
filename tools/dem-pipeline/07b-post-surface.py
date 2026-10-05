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

输入：`.local/dem-work/filled_utm48n_cut_ell.tif`（椭球件优先，15-ellipsoid-shift.py
      产物；缺失回退 filled_utm48n_cut.tif 走 EGM96 正高链）。
      基准纪律（2026-10-05 统一基准后）：设计水位（正高）是否 +N 换算**跟随 DEM 基准**，
      不跟随 --grid 是否存在——EGM96 地表配椭球水位（或反之）= 渠底整体错位 ~21m，
      属静默错位地表；椭球件缺 grid 直接报错，不出错件。
输出：`post_surface_utm48n.tif` → 交给 07c 重切

⚠ 原始 DEM 只读，不修改。
"""
from __future__ import annotations

import argparse
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
# 2026-10-05 统一基准后的椭球件（15-ellipsoid-shift.py 产物；命名约定 *_ell.tif）
DEM_ELL = REPO / ".local/dem-work/filled_utm48n_cut_ell.tif"
ANCHOR = (108.8300, 22.2000)


def default_dem() -> Path:
    """缺省源 DEM：椭球件优先（现役地形链口径），缺失回退 EGM96 正高件。"""
    return DEM_ELL if DEM_ELL.exists() else DEM


def datum_kind(dem: Path) -> str:
    """DEM 垂直基准判别：文件名带 ``_ell``（15 号产物命名约定）⇒ 椭球高，否则 EGM96 正高。"""
    return "ell" if "_ell" in Path(dem).stem else "egm96"


def plan_level_shift(dem: Path, grid_available: bool) -> str:
    """设计水位（正高）是否 +N 换算——跟随 DEM 基准，不跟随 grid 是否存在。

    返回 'shift'（椭球链：水位 +N）/ 'skip'（EGM96 自洽链：水位原样）；
    椭球件缺 grid 时抛 ValueError（水位无法换算，fail-loud 不出静默错位地表）。
    """
    if datum_kind(dem) == "ell":
        if not grid_available:
            raise ValueError(
                f"{Path(dem).name} 是椭球件，设计水位（正高）必须 +N 换算，"
                "但 EGM96 网格不可用：传 --grid <us_nga_egm96_15.tif> 或改用 EGM96 正高件"
            )
        return "shift"
    return "skip"

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
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", default=None,
                    help="源 DEM；缺省自动解析（椭球件 *_ell.tif 优先，回退 EGM96 正高件）")
    ap.add_argument("--out-dir", default=str(OUT))
    ap.add_argument(
        "--grid",
        default=str(REPO / ".local/proj/us_nga_egm96_15.tif"),
        help="EGM96 15′ 网格；椭球 DEM 时用于把设计水位（正高）+N 换算为大地高（对 EGM96 DEM 无效，自动忽略）",
    )
    ap.add_argument(
        "--canal-line",
        default=None,
        help="运河中线 JSON（build-canal.mjs --emit-line 产物：逐点 lon/lat/h 大地高）；给出时沿全线开挖渠槽",
    )
    args = ap.parse_args()
    dem_path = Path(args.dem) if args.dem else default_dem()
    grid_ok = bool(args.grid) and Path(args.grid).exists()
    # 水位换算跟随 DEM 基准：椭球件缺 grid 在此 fail-loud，不出静默错位地表
    try:
        plan = plan_level_shift(dem_path, grid_ok)
    except ValueError as e:
        raise SystemExit(f"[基准] {e}")
    if args.canal_line and plan != "shift":
        raise SystemExit(
            "[基准] --canal-line 的中线 h 是大地高，只能刻椭球 DEM；"
            "改用 *_ell.tif（15-ellipsoid-shift.py 产物）"
        )
    n_shift = {h: 0.0 for h in HUBS}
    if plan == "shift":
        with rasterio.open(args.grid) as g:
            for h, c in HUBS.items():
                n_shift[h] = float(next(g.sample([(c["lon"], c["lat"])]))[0])
        print("[基准] 大地高链：" + dem_path.name + " ｜ 设计水位 +N（正高→椭球）： "
              + " ｜ ".join(f"{h} {n_shift[h]:+.2f}" for h in HUBS), flush=True)
    elif args.grid and grid_ok:
        print(f"[基准] EGM96 正高链：{dem_path.name} ｜ --grid 对正高件无效，水位不换算", flush=True)
    else:
        print(f"[基准] EGM96 正高链：{dem_path.name} ｜ 设计水位原样使用", flush=True)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    with rasterio.open(dem_path) as src:
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
        up_wl = c["up_wl"] + n_shift[hub]
        dn_wl = c["dn_wl"] + n_shift[hub]
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
        bot_up = up_wl - DRAFT
        bot_dn = dn_wl - DRAFT
        t = np.clip((s - (X_LOCK0 - TAPER)) / TAPER, 0.0, 1.0)
        bot = bot_up * (1 - t) + bot_dn * t
        bot = np.where(s >= X_LOCK0, bot_dn, bot)
        # 开挖面 = 渠槽 → 平台 → 1:2 边坡与原地形相接
        plat = max(up_wl, dn_wl) + PLAT_RISE
        ad = np.abs(d)
        ramp = np.where(ad <= CH_W / 2, bot,
                        np.where(ad <= PLAT_HALF, plat,
                                 plat + (ad - PLAT_HALF) / SLOPE))
        # nodata 像元（海侧/缺口，值=32767）不得参与开挖：否则会被"挖"成正常海拔、污染成陆
        vm = post != nodata
        carve = np.where(vm, np.minimum(post, ramp), post)
        # 渠底强制（|d| < 渠底宽/2）：保证渠槽存在
        carve = np.where(vm & (ad < CH_W / 2), bot, carve)
        # 平台面强制（渠边 → 平台半宽）：保证工地平台存在（只在下挖意义下）
        carve = np.where(vm & (ad >= CH_W / 2) & (ad < PLAT_HALF),
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

    # ===== 全线运河开挖（2026-10-05）=====
    # 中线来自 computeCanalLine（与运河带同一来源）；渠槽：底宽 80 m（h−8）、1:2 边坡上升至岸边。
    # 只挖不填（min(post, 开挖面)），逐段窗口矢量计算，段间重叠处 min 幂等。
    if args.canal_line:
        line = json.loads(Path(args.canal_line).read_text(encoding="utf-8"))["points"]
        pts = []
        for p in line:
            ex, ny = warp_transform("EPSG:4326", crs, [p["lon"]], [p["lat"]])
            pts.append((ex[0], ny[0], float(p["h"])))
        MARGIN = 220.0
        mask = np.zeros(post.shape, dtype=bool)
        max_cut = 0.0
        nodata_skipped = 0
        for i in range(len(pts) - 1):
            x0, y0, h0 = pts[i]
            x1, y1, h1 = pts[i + 1]
            seg = math.hypot(x1 - x0, y1 - y0)
            if seg < 1e-6 or seg > 500:  # >500m = 两条链之间的真实断口，不得当作渠段
                continue
            ux, uy = (x1 - x0) / seg, (y1 - y0) / seg
            left, top = (~tr) * (min(x0, x1) - MARGIN, max(y0, y1) + MARGIN)
            right, bottom = (~tr) * (max(x0, x1) + MARGIN, min(y0, y1) - MARGIN)
            c0 = max(0, int(math.floor(left)))
            c1 = min(W - 1, int(math.ceil(right)))
            r0 = max(0, int(math.floor(top)))
            r1 = min(H - 1, int(math.ceil(bottom)))
            if c1 < c0 or r1 < r0:
                continue
            cols, rows = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
            xs, ys = rasterio.transform.xy(tr, rows, cols)
            xs = np.asarray(xs, dtype=np.float64).reshape(rows.shape)
            ys = np.asarray(ys, dtype=np.float64).reshape(rows.shape)
            t = np.clip((xs - x0) * ux + (ys - y0) * uy, 0.0, seg)
            dist = np.hypot(xs - (x0 + ux * t), ys - (y0 + uy * t))
            h = h0 + (h1 - h0) * (t / seg)
            bed = h - DRAFT
            profile = np.where(
                dist <= CH_W / 2,
                bed,
                np.where(
                    dist <= CH_W / 2 + DRAFT * SLOPE,
                    bed + (dist - CH_W / 2) / SLOPE,
                    h + (dist - (CH_W / 2 + DRAFT * SLOPE)) / SLOPE,
                ),
            )
            block = post[r0 : r1 + 1, c0 : c1 + 1]
            # nodata 像元保持原值（写出口径统一转 -32768），只挖有效地形
            vblock = block != nodata
            cut = np.where(vblock, np.minimum(block, profile), block)
            dcut = np.where(vblock, block - cut, 0.0)
            mask[r0 : r1 + 1, c0 : c1 + 1] |= dcut > 0.5
            max_cut = max(max_cut, float(dcut.max()))
            nodata_skipped += int((~vblock).sum())
            post[r0 : r1 + 1, c0 : c1 + 1] = cut
        report["canal"] = {"points": len(pts), "cells_cut": int(mask.sum()),
                           "max_cut_m": max_cut, "nodata_cells_skipped": nodata_skipped}
        print(
            f"[canal] 中线 {len(pts)} 点 ｜ 最大挖深 {max_cut:6.1f} m ｜ 挖方像元 {int(mask.sum())}"
            f"（≈{mask.sum() * 900 / 1e6:.2f} km²）｜ nodata 跳过 {nodata_skipped}",
            flush=True,
        )

    out = out_dir / "post_surface_utm48n.tif"
    prof.update(dtype="int16", nodata=-32768, compress="deflate")
    with rasterio.open(out, "w", **prof) as dst:
        o = np.where(valid, np.round(post), -32768).astype("int16")
        dst.write(o, 1)
    print(f"\n-> {out}  ({out.stat().st_size/1e6:.1f} MB)")
    (out_dir / "post-surface-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
