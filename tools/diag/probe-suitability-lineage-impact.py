"""探针 B（venv, rasterio/numpy）：A2 地形因子链错代的下游材料性（只读）。

对照两侧：
  旧 = 09-29 口径 terrain_factors.gpkg（先跑 probe-suitability-old-blocks.py 转 CSV）；
  新 = 按现役 DEM 重派生（backend/data/flood/dem/landsea_utm48n.tif + 由其
       gdaldem 出的 slope-new.tif + 现役 filled_utm48n_cut.tif，聚合口径同
       tools/dem-pipeline/12-terrain-factors.py：16×16 块、mean/max/land_frac）。
折算评分用现役定稿 score.constants（浸没 1/6m、地形 5/20°）。

2026-10-05 实测（自检全过）：未变块 143,677 个 |Δelev| 中位/P95 = 0.0000；
新旧陆像元总差 = 756,123 + 4,066,341 = 4,822,464 px（与掩膜差逐位一致）。
受影响块 22,289 = 变化 4,746 + 新冒 17,543；既有变化块 |Δ浸没|>0.1 = 721
（>0.2 = 356）、|Δ地形|>0.1 = 295（>0.2 = 157）；界内受影响 7,152 块
（变化 3,713 + 新冒 3,439；界内块总数 91,788）。

前置：QGIS python 跑 probe-suitability-old-blocks.py；
      gdaldem slope backend/data/flood/dem/landsea_utm48n.tif
        -> .local/suitability-materiality/slope-new.tif（computeEdges=True，度）。
用法：python -X utf8 tools/diag/probe-suitability-lineage-impact.py
"""
import csv
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom

REPO = Path(__file__).resolve().parents[2]
NOD = 32767
BLK = 16


def main() -> None:
    with rasterio.open(REPO / "backend/data/flood/dem/landsea_utm48n.tif") as ds:
        new_ls = ds.read(1)
        T = ds.transform
        crs = ds.crs
    with rasterio.open(REPO / ".local/suitability-materiality/slope-new.tif") as ds:
        new_slope = ds.read(1)
    with rasterio.open(REPO / ".local/dem-work/filled_utm48n_cut.tif") as ds:
        new_cut = ds.read(1)
    H, W = new_ls.shape
    nb_r, nb_c = -(-H // BLK), -(-W // BLK)

    def pad(a, fill):
        out = np.full((nb_r * BLK, nb_c * BLK), fill, dtype=a.dtype)
        out[:H, :W] = a
        return out

    dem_p = pad(new_ls, NOD)
    slope_p = pad(new_slope, -9999)
    sea_p = pad(new_cut == NOD, True)
    land_p = ~sea_p & (dem_p != NOD) & (dem_p < 30000)
    dem_b = dem_p.reshape(nb_r, BLK, nb_c, BLK)
    slope_b = slope_p.reshape(nb_r, BLK, nb_c, BLK)
    land_b = land_p.reshape(nb_r, BLK, nb_c, BLK)
    cnt_new = land_b.sum(axis=(1, 3))
    with np.errstate(invalid="ignore"):
        elev_new = np.where(
            cnt_new > 0,
            np.nansum(np.where(land_b, dem_b, np.nan), axis=(1, 3)) / np.maximum(cnt_new, 1),
            np.nan,
        )
        slope_new_b = np.where(
            cnt_new > 0,
            np.nansum(np.where(land_b, slope_b, np.nan), axis=(1, 3)) / np.maximum(cnt_new, 1),
            np.nan,
        )
    landfrac_new = cnt_new / (BLK * BLK)

    old = {"r": [], "c": [], "elev": [], "slope": [], "lf": []}
    with (REPO / ".local/suitability-materiality/old-blocks.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            old["r"].append(int(row["row"]))
            old["c"].append(int(row["col"]))
            old["elev"].append(float(row["elev"]))
            old["slope"].append(float(row["slope"]))
            old["lf"].append(float(row["landfrac"]))
    orow = np.array(old["r"])
    ocol = np.array(old["c"])
    oelev = np.array(old["elev"])
    oslope = np.array(old["slope"])
    olf = np.array(old["lf"])
    print(f"旧 gpkg 行数 = {len(orow)}；最大索引 r={orow.max()} c={ocol.max()}（网格 {nb_r}×{nb_c}）")

    old_cnt = np.round(olf * BLK * BLK).astype(int)
    new_cnt_at_old = cnt_new[orow, ocol]
    new_elev_at_old = elev_new[orow, ocol]
    new_slope_at_old = slope_new_b[orow, ocol]
    new_lf_at_old = landfrac_new[orow, ocol]

    dcnt = new_cnt_at_old - old_cnt
    aff = dcnt > 0
    print(
        f"旧块中内容变化（归还陆像元入块）的块数 = {int(aff.sum())} / {len(orow)}；"
        f"归还像元合计（这些块内）= {int(dcnt[aff].sum())}"
    )

    def inun(e):
        e = np.asarray(e, dtype=float)
        out = 0.05 + (e - 1.0) / (6.0 - 1.0) * 0.95
        return np.where(e <= 1.0, 0.05, np.where(e >= 6.0, 1.0, out))

    def terrain(s):
        s = np.asarray(s, dtype=float)
        out = 1.0 - (s - 5.0) / (20.0 - 5.0) * 0.9
        return np.where(s <= 5.0, 1.0, np.where(s >= 20.0, 0.1, out))

    d_elev = new_elev_at_old - oelev
    d_slope = new_slope_at_old - oslope
    d_inun = inun(new_elev_at_old) - inun(oelev)
    d_terr = terrain(new_slope_at_old) - terrain(oslope)

    print("\n== 受影响旧块（dcnt>0）逐项差 ==")
    for name, arr in [
        ("Δmean_elev(m)", d_elev),
        ("Δmean_slope(°)", d_slope),
        ("Δland_frac", new_lf_at_old - olf),
    ]:
        a = arr[aff]
        print(
            f"{name}: |Δ|中位={np.nanmedian(np.abs(a)):.3f} "
            f"P95={np.nanpercentile(np.abs(a), 95):.3f} max={np.nanmax(np.abs(a)):.1f} | "
            f">0.1 的块={int((np.abs(a) > 0.1).sum())} >1 的块={int((np.abs(a) > 1).sum())}"
        )
    for name, arr in [("Δ浸没适宜度", d_inun), ("Δ地形适宜度", d_terr)]:
        a = arr[aff]
        print(
            f"{name}: 中位={np.nanmedian(a):+.4f} |Δ|>0.05 块={int((np.abs(a) > 0.05).sum())} "
            f"|Δ|>0.1 块={int((np.abs(a) > 0.1).sum())} |Δ|>0.2 块={int((np.abs(a) > 0.2).sum())} "
            f"max={np.nanmax(np.abs(a)):.3f}"
        )

    in_old = np.zeros((nb_r, nb_c), dtype=bool)
    in_old[orow, ocol] = True
    new_only = (cnt_new > 0) & ~in_old
    print(f"\n新口径新增块（旧 gpkg 无、现含陆）= {int(new_only.sum())} 块")

    gj = json.loads(
        (REPO / "frontend/public/data/route-analysis/boundary.geojson").read_text(encoding="utf-8")
    )
    geoms = [transform_geom("EPSG:4326", crs, f["geometry"]) for f in gj["features"]]
    block_T = rasterio.Affine(T.a * BLK, 0, T.c, 0, T.e * BLK, T.f)
    inb_block = rasterize(
        [(g, 1) for g in geoms],
        out_shape=(nb_r, nb_c),
        transform=block_T,
        fill=0,
        dtype="uint8",
        all_touched=True,
    ).astype(bool)
    aff_inb = aff & inb_block[orow, ocol]
    print(
        f"其中界内块 = {int(aff_inb.sum())}（占受影响 "
        f"{100.0 * aff_inb.sum() / max(aff.sum(), 1):.1f}%）；界内受影响块里 "
        f"|Δ浸没|>0.1 = {int((np.abs(d_inun[aff_inb]) > 0.1).sum())}，"
        f"|Δ地形|>0.1 = {int((np.abs(d_terr[aff_inb]) > 0.1).sum())}"
    )
    print(f"新冒块中界内 = {int((new_only & inb_block).sum())} / {int(new_only.sum())}")

    same = dcnt == 0
    print(
        f"\n[自检A] dcnt==0 块 = {int(same.sum())}；|Δelev| 中位="
        f"{np.nanmedian(np.abs(d_elev[same])):.4f} P95="
        f"{np.nanpercentile(np.abs(d_elev[same]), 95):.4f}；|Δslope| 中位="
        f"{np.nanmedian(np.abs(d_slope[same])):.4f}"
    )
    tot_joined = int(dcnt.sum())
    tot_newonly = int(cnt_new[new_only].sum())
    print(
        f"[自检B] 旧块内新增 px={tot_joined}；新冒块 px={tot_newonly}；"
        f"合计={tot_joined + tot_newonly}（掩膜差参考 4,822,464）"
    )
    print(f"[参照] 全体含陆新块={int((cnt_new > 0).sum())}；界内块总数={int(inb_block.sum())}")


if __name__ == "__main__":
    main()
