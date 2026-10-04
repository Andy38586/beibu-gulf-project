"""
06-sea-mask.py — 海岸线矢量海掩膜（2026-08-30，全链路重算配套）

背景：两个候选 DEM 的海面语义都有缺陷——
  ASTER GDEM：海面为整 0 值（非 nodata），连通性演算把海面算成"淹没"；
  GLO-30：海面为 0~13m 成片伪值且大陆侧沿海地形偏高 12~30m，不适用沿海淹没。
WorldCover 水类在外海 75% 缺失、水域矢量不含海，均不可用。

方法（真实数据派生，标准制图约定）：
  海 = 海岸线矢量（beibu-coastline.geojson，~73k 顶点 ~14m 间距）以南。
  逐栅格列取海岸线顶点最大 northing = 大陆岸线；像素中心 northing 小于该值即海，
  置 nodata。岛屿（涠洲岛等，位于大陆岸线以南）并入海掩膜——披露的已知取舍。
  最终链用 ASTER（沿海低地真实）+ 本掩膜（海面干净）。

2026-10-04 修正（域内 1139.8 km² 陆地被误吞）：
   逐列取"最北顶点"在河口/内湾列会跳到湾顶纬度，把该列湾顶以南的**陆地**一并置海。
   实测（`.local/flood-recompute/probe-mask-loss.py`）：旧掩膜在 12 区县边界内吃掉
   1139.8 km² 正高程像元，其中 ASTER 原件自判陆地的 938.9 km²（ASTER>0 & SRTM15+>0）。
   故新规则 = 海岸线判据 **∩** 测深源判据 **∩** 源 DEM 自判非陆地：
   只有测深栅格（SRTM15+）也判海（值 ≤ 0）**且源 DEM 自身也不判陆**（值 ≤ 0）才置 nodata；
   测深无值（源覆盖外的东缘）沿用海岸线判据。
   这一步不放宽任何"什么算海"的口径——它只是把海岸线判据的单侧误吞收回，
   与 `10-landsea-merge.py` 实际采用的"海=SRTM15+ 水深"语义对齐（同一份权威源）。
   第三条的必要性（同日实测）：SRTM15+ 原生 15″≈460m，看不见窄码头/防波堤，
   只靠它确认会把钦州/防城港港区码头判成水深——83 个港口设施里 33 个的 5x5 窗口
   整窗落在"海"上（钦州港口岸 -3m）。ASTER 30m 在这些码头上是实高程。

用法（CRS 通用，源 DEM 任意投影）：
  .venv/Scripts/python.exe tools/dem-pipeline/06-sea-mask.py \
      <源DEM> <输出DEM> [海岸线geojson] [测深栅格]
  第 4 参缺省即退回 2026-08-30 的旧行为（仅海岸线判据）——仅在无测深源时使用，
  并在 stdout 打印 warning（产物会带上"单侧判据"这一已知缺陷）。
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform

DEFAULT_COAST = Path(
    r"C:/Users/JionHappY/Desktop/_北部湾项目/06-数据备份/数据_/项目数据/海岸线/beibu-coastline.geojson"
)
# 海岸线顶点收集框（略大于裁切框，保证逐列插补有界外余量）
BOX = (106.9, 110.1, 20.9, 23.1)


def collect_coast_vertices(geojson_path):
    j = json.load(open(geojson_path, encoding="utf-8"))
    lons, lats = [], []

    def walk(c):
        for x in c:
            if isinstance(x[0], (int, float)) and isinstance(x[1], (int, float)):
                lons.append(x[0])
                lats.append(x[1])
            elif x:
                walk(x)

    for f in j["features"]:
        if f.get("geometry"):
            walk(f["geometry"]["coordinates"])
    lons, lats = np.array(lons), np.array(lats)
    m = (lons >= BOX[0]) & (lons <= BOX[1]) & (lats >= BOX[2]) & (lats <= BOX[3])
    return lons[m], lats[m]


def bathy_sea_mask(src, bathy_path):
    """把测深栅格采样到源 DEM 网格，返回 True = 测深源判海（<=0 或该处无值）。

    无值（NaN/nodata）处返回 True：给源覆盖外留旧行为（东缘 SRTM15+ 止于 110.000°E），
    避免在无替代数据的地方把海判成陆。
    网格不一致时按仿射坐标做最近邻采样（与 10-landsea-merge.py 同口径）。
    """
    with rasterio.open(bathy_path) as b:
        bt = b.transform
        bw, bh = b.width, b.height
        bathy = b.read(1)  # float32 整幅：与源 DEM 网格不同，按仿射取样
        sea = np.zeros((src.height, src.width), dtype=bool)
        t = src.transform
        fc_all = (t.c + (np.arange(src.width) + 0.5) * t.a - bt.c) / bt.a - 0.5
        jr = np.clip(np.rint(fc_all).astype(np.int64), 0, bw - 1)
        for r0 in range(0, src.height, 1024):
            r1 = min(r0 + 1024, src.height)
            ys = t.f + (np.arange(r0, r1) + 0.5) * t.e
            fr = (ys[:, None] - bt.f) / bt.e - 0.5
            ir = np.clip(np.rint(fr).astype(np.int64), 0, bh - 1)
            v = bathy[ir, jr]
            nan = ~np.isfinite(v)
            sea[r0:r1] = nan | (v <= 0)
    return sea


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src_p, out_p = Path(sys.argv[1]), Path(sys.argv[2])
    coast_p = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_COAST
    bathy_p = Path(sys.argv[4]) if len(sys.argv) > 4 else None

    lons, lats = collect_coast_vertices(coast_p)
    with rasterio.open(src_p) as src:
        t = src.transform
        w, h = src.width, src.height
        dem = src.read(1)
        prof = src.profile
        xs, ys = transform("EPSG:4326", src.crs, lons.tolist(), lats.tolist())

    xs, ys = np.array(xs), np.array(ys)
    cols = ((xs - t.c) / t.a).astype(int)
    coast_y = np.full(w, -np.inf)
    np.maximum.at(coast_y, np.clip(cols, 0, w - 1), ys)  # 每列最大 northing = 大陆岸线
    valid = np.where(coast_y > -np.inf)[0]
    coast_y = np.interp(np.arange(w), valid, coast_y[valid])  # 空列最近插补

    northing = t.f + np.arange(h) * t.e
    sea = northing[:, None] < coast_y[None, :]
    print(f"海岸线顶点(框内): {len(xs)} | 海岸线判据 sea: {100 * sea.mean():.1f}%")

    # 第三条：源 DEM 自判陆地的像元一律保留。ASTER 的海面是**整 0**，正高程即陆地；
    # 460m 的 SRTM15+ 看不见窄码头/防波堤/养殖塘堤，只靠它确认会把港区码头抹成水深
    # （2026-10-04 实测：83 个港口设施里 33 个的 5x5 窗口整窗落在"海"上，钦州港口岸
    # 变成 -3m）。这一条只**归还**陆地，不新增水面，故不放宽任何判海口径。
    source_land = dem > 0
    px_km2 = (abs(t.a) / 1000.0) * (abs(t.e) / 1000.0)

    if bathy_p is None:
        print(
            "WARNING: 未提供测深栅格——仅用海岸线单侧判据（旧行为，河口/内湾列会误吞陆地）",
            file=sys.stderr,
        )
    else:
        with rasterio.open(src_p) as src:
            bathy_sea = bathy_sea_mask(src, bathy_p)
        restored = int((sea & ~bathy_sea).sum())
        print(
            f"测深确认: {bathy_p.name} | 交后 sea: {100 * (sea & bathy_sea).mean():.1f}%"
            f" | 归还陆地 {restored} px = {restored * px_km2:.1f} km²"
            f"（ASTER 值回暖，非新增水面）"
        )
        sea = sea & bathy_sea
    kept_by_source = int((sea & source_land).sum())
    print(
        f"源 DEM 自判陆地的保留: {kept_by_source} px = {kept_by_source * px_km2:.1f} km²（第三条）"
    )
    sea = sea & ~source_land

    dem[sea] = prof["nodata"]
    with rasterio.open(out_p, "w", **prof) as dst:
        dst.write(dem, 1)
    print(f"written: {out_p}")


if __name__ == "__main__":
    main()
