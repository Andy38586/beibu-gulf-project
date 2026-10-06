"""11-seam-audit.py — 接缝与偏差结构审计（2026-09-27）
问题：10-merge 接缝审计给的整体 -6.87m 是"陆上 ASTER vs 陆上 SRTM15+"的差，
不是成品海岸线两侧的台阶。本脚本量三件事：
  A. 成品真实台阶：紧邻海岸线两侧（陆 1~5 px vs 海 1~5 px）的高差
  B. ASTER vs SRTM15+ 陆上偏差按高程分带（判断是否常数偏移）
  C. 未填的 27.9 万 px 的空间分布（bbox 聚类）
"""
import numpy as np
from osgeo import gdal, gdalconst
from scipy import ndimage

gdal.UseExceptions()

import sys

REPO = r"C:/workspace/beibu-gulf-project"
CUT = sys.argv[1] if len(sys.argv) > 1 else rf"{REPO}/.local/dem-work/filled_utm48n_cut.tif"
SEA = sys.argv[2] if len(sys.argv) > 2 else rf"{REPO}/.local/dem-sea-work/sea_custom.tif"
OUT = sys.argv[3] if len(sys.argv) > 3 else rf"{REPO}/.local/dem-sea-work/landsea_utm48n.tif"

d = gdal.Open(OUT, gdalconst.GA_ReadOnly)
dcut = gdal.Open(CUT, gdalconst.GA_ReadOnly)  # 必须存变量（坑③ GC 悬空）
cut = dcut.GetRasterBand(1).ReadAsArray()
dsea = gdal.Open(SEA, gdalconst.GA_ReadOnly)
sea = dsea.GetRasterBand(1).ReadAsArray()
out = d.GetRasterBand(1).ReadAsArray()
NOD = 32767

land_mask = cut != NOD          # 陆地（ASTER 侧）
sea_mask = cut == NOD           # 海区（SRTM15+ 填充侧）
filled = sea_mask & (out != NOD)

# ---- A. 成品真实台阶：海岸带两侧各 1~5 px ----
sea_dil = ndimage.binary_dilation(sea_mask, iterations=5)
land_coast = land_mask & sea_dil                       # 距海 ≤5px 的陆地
sea_coast = filled & ndimage.binary_dilation(land_mask, iterations=5) & ~land_mask
lv = out[land_coast].astype(np.float64)
sv = out[sea_coast].astype(np.float64)
print(f"A. 海岸带陆地（≤150m） n={len(lv)}: 中位 {np.median(lv):+.2f}m  P5 {np.percentile(lv,5):+.2f}  P95 {np.percentile(lv,95):+.2f}")
print(f"   海岸带海域（≤150m） n={len(sv)}: 中位 {np.median(sv):+.2f}m  P5 {np.percentile(sv,5):+.2f}  P95 {np.percentile(sv,95):+.2f}")
print(f"   两侧中位差（海-陆）: {np.median(sv)-np.median(lv):+.2f}m")

# ---- B. 陆上偏差按高程分带（ASTER - SRTM15+，取 SRTM15+ 双线性，避免上采样锯齿）----
gt = d.GetGeoTransform()
ox, oy, px, py = gt[0], gt[3], gt[1], gt[5]
sgt = dsea.GetGeoTransform()
sox, soy, spx, spy = sgt[0], sgt[3], sgt[1], sgt[5]
H, W = cut.shape
# 分块双线性采样 SRTM15+，只在陆地上
diffs = {}
for r0 in range(0, H, 1500):
    r1 = min(r0 + 1500, H)
    ys = oy + (np.arange(r0, r1) + 0.5) * py
    xs = ox + (np.arange(W) + 0.5) * px
    fr = (ys[:, None] - soy) / spy - 0.5
    fc = (xs[None, :] - sox) / spx - 0.5
    i0 = np.clip(np.floor(fr).astype(np.int64), 0, sea.shape[0] - 2)
    j0 = np.clip(np.floor(fc).astype(np.int64), 0, sea.shape[1] - 2)
    fy, fx = fr - i0, fc - j0
    p00 = sea[i0, j0]; p01 = sea[i0, j0 + 1]; p10 = sea[i0 + 1, j0]; p11 = sea[i0 + 1, j0 + 1]
    ok = ~np.isnan(p00) & ~np.isnan(p01) & ~np.isnan(p10) & ~np.isnan(p11)
    bil = (p00 * (1 - fx) + p01 * fx) * (1 - fy) + (p10 * (1 - fx) + p11 * fx) * fy
    lm = land_mask[r0:r1] & ok
    dd = cut[r0:r1].astype(np.float64) - bil
    for lo, hi in [(2, 20), (20, 50), (50, 100), (100, 200), (200, 600)]:
        m = lm & (cut[r0:r1] >= lo) & (cut[r0:r1] < hi)
        key = f"{lo}-{hi}"
        diffs.setdefault(key, []).append(dd[m])
print("B. 陆上 ASTER - SRTM15+ 按高程分带（双线性）:")
for k, v in diffs.items():
    a = np.concatenate(v)
    if len(a) > 100:
        print(f"   {k:>8}m n={len(a):>9}: 中位 {np.median(a):+.2f}  P5 {np.percentile(a,5):+.2f}  P95 {np.percentile(a,95):+.2f}")

# ---- C. 未填像素分布 ----
unfilled = sea_mask & (out == NOD)
ys_u, xs_u = np.where(unfilled)
print(f"C. 未填 n={len(ys_u)}")
if len(ys_u):
    # 每 500px 网格聚类报告
    from collections import Counter
    cells = Counter(zip((ys_u // 500).tolist(), (xs_u // 500).tolist()))
    for (cy, cx), n in cells.most_common(8):
        gy = oy - cy * 500 * 30
        gx = ox + cx * 500 * 30
        print(f"   聚类 y{cy*500}-{cy*500+500} x{cx*500}-{cx*500+500}: {n}px  (≈E{gx:.0f} N{gy:.0f})")
