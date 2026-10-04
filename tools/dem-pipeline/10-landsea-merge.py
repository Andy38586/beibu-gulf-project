"""
10-landsea-merge.py v3 — 海陆一体 DEM 合成（全向量化分块，2026-09-27）

输入（同 CRS = custom TM CM108/FE500000）：
  <cut>  陆地权威版（海=nodata 32767，Int16）     默认 .local/dem-work/filled_utm48n_cut.tif
  <sea>  海域源（SRTM15+ 重采样 30m，nodata=NaN） 默认 .local/dem-sea-work/sea_custom.tif
输出：
  <out>  海陆一体（Int16）+ 控制台接缝审计        默认 .local/dem-sea-work/landsea_utm48n.tif

用法：python 10-landsea-merge.py [cut.tif] [sea.tif] [out.tif]
（需 osgeo/GDAL；本机用 QGIS 自带 python，见 tools/dem-pipeline/README 的运行环境说明）

坑（留痕）：①nc nodata=NaN，warp -dstnodata 与之冲突全图空；②本 GDAL 构建 -te 被静默
忽略（-te/-te_srs 实测）→ 海域源按自身范围重采样后以仿射坐标采样对齐；③gdal.Open
结果必须存变量（GC 悬空 band）；④osr 变换默认 lat/lon 轴序（OAMS_TRADITIONAL_GIS_ORDER
修正）。
"""
import sys

import numpy as np
from osgeo import gdal, gdalconst

gdal.UseExceptions()

REPO = r"C:/workspace/beibu-gulf-project"
CUT = sys.argv[1] if len(sys.argv) > 1 else rf"{REPO}/.local/dem-work/filled_utm48n_cut.tif"
SEA = sys.argv[2] if len(sys.argv) > 2 else rf"{REPO}/.local/dem-sea-work/sea_custom.tif"
OUT = sys.argv[3] if len(sys.argv) > 3 else rf"{REPO}/.local/dem-sea-work/landsea_utm48n.tif"
NODATA = 32767
CHUNK = 800


def main():
    d_cut = gdal.Open(CUT, gdalconst.GA_ReadOnly)
    gt = d_cut.GetGeoTransform()
    ox, oy, px, py = gt[0], gt[3], gt[1], gt[5]
    W, H = d_cut.RasterXSize, d_cut.RasterYSize
    cut = d_cut.GetRasterBand(1).ReadAsArray()

    d_sea = gdal.Open(SEA, gdalconst.GA_ReadOnly)
    sgt = d_sea.GetGeoTransform()
    sox, soy, spx, spy = sgt[0], sgt[3], sgt[1], sgt[5]
    sea = d_sea.GetRasterBand(1).ReadAsArray()
    sh, sw = sea.shape

    xs = ox + (np.arange(W) + 0.5) * px          # cut 像素中心 UTM x（W）
    fc_all = (xs[None, :] - sox) / spx - 0.5      # sea 浮点列（H×W 广播）

    out = cut.astype(np.int16).copy()
    sea_area = cut == NODATA
    print(f"cut {W}x{H} | sea 源 {sw}x{sh} | 海区 {int(sea_area.sum())} px（{100*sea_area.mean():.1f}%）")

    for r0 in range(0, H, CHUNK):
        r1 = min(r0 + CHUNK, H)
        ys = oy + (np.arange(r0, r1) + 0.5) * py
        fr = (ys[:, None] - soy) / spy - 0.5                      # (n, 1)
        fc = fc_all                                               # (1, W) 全宽，广播到 (n, W)
        i0 = np.clip(np.floor(fr).astype(np.int64), 0, sh - 2)
        j0 = np.clip(np.floor(fc).astype(np.int64), 0, sw - 2)
        fy = fr - i0
        fx = fc - j0
        p00 = sea[i0, j0]
        p01 = sea[i0, j0 + 1]
        p10 = sea[i0 + 1, j0]
        p11 = sea[i0 + 1, j0 + 1]
        ok = (
            ~np.isnan(p00) & ~np.isnan(p01) & ~np.isnan(p10) & ~np.isnan(p11)
        )
        bil = (p00 * (1 - fx) + p01 * fx) * (1 - fy) + (p10 * (1 - fx) + p11 * fx) * fy
        ir = np.clip(np.rint(fr).astype(np.int64), 0, sh - 1)
        jr = np.clip(np.rint(fc).astype(np.int64), 0, sw - 1)
        near = sea[ir, jr]
        near_ok = ~np.isnan(near)

        take = sea_area[r0:r1] & ok
        region = out[r0:r1]
        region[take] = np.round(bil[take]).astype(np.int16)
        fb = sea_area[r0:r1] & ~ok & near_ok
        region[fb] = np.round(near[fb]).astype(np.int16)

    filled = int(((out != NODATA) & sea_area).sum())
    print(f"海区已填 {filled} | 仍未填 {int((sea_area & (out == NODATA)).sum())}")

    # 接缝审计：海岸带陆地（|h|≤20m）处 ASTER vs SRTM15+
    ys_all = oy + (np.arange(H) + 0.5) * py
    fr_all = (ys_all[:, None] - soy) / spy - 0.5
    fc_all = (xs[None, :] - sox) / spx - 0.5
    ir = np.clip(np.rint(fr_all).astype(np.int64), 0, sh - 1)
    jr = np.clip(np.rint(fc_all).astype(np.int64), 0, sw - 1)
    s_at = sea[ir, jr]
    land = cut != NODATA
    strip = land & ~np.isnan(s_at) & (np.abs(out.astype(np.float64)) <= 20)
    dd = out.astype(np.float64)[strip] - s_at[strip]
    if len(dd):
        print(
            f"接缝审计（海岸带 n={len(dd)}）: 均值 {dd.mean():+.2f}m | 中位 {np.median(dd):+.2f}m "
            f"| P5 {np.percentile(dd,5):+.2f} | P95 {np.percentile(dd,95):+.2f}"
        )
    else:
        print("接缝审计：无同点样本，需人工检查")

    drv = gdal.GetDriverByName("GTiff")
    ods = drv.Create(OUT, W, H, 1, gdalconst.GDT_Int16, options=["COMPRESS=DEFLATE", "TILED=YES"])
    ods.SetGeoTransform(gt)
    ods.SetProjection(d_cut.GetProjection())
    ob = ods.GetRasterBand(1)
    ob.SetNoDataValue(NODATA)
    ob.WriteArray(out)
    ob.FlushCache()
    print("written:", OUT)


if __name__ == "__main__":
    main()
