"""probe-terrain-vs-dem.py — 服务中的地形瓦片 vs 当前统一 DEM 的一致性探针（只读）。

用途：回答"服务里的地形是不是旧掩膜/旧 DEM 时代的产物、要不要重切"。
做法：取一张 z 级瓦片，按 heightmap-1.0 解码 65×65 高程网格，把每个节点换算回 DEM 坐标
取样当前 DEM，比 served（盘上瓦片）与 fresh（可选：另一份重切结果）各自对 DEM 的偏差；
并把节点按"是否落在 10-04 海掩膜修归还的陆地区"（旧掩膜版 nodata）分组。

用法（venv，需 rasterio/numpy）：
  python -X utf8 tools/diag/probe-terrain-vs-dem.py [z x y] [fresh.terrain]
默认 12 6565 1549（含 583 个归还陆地节点的一张瓦片）。

2026-10-04 实测（该瓦片 4225 节点 / 归还陆地区 583）：
  served（2026-09-09 烘焙） vs 当前 DEM：均 |Δ| 0.34 m、P95 2.00 m、>5m 26 节点
  fresh（今日按当前 cut 重切） vs 当前 DEM：均 |Δ| 0.31 m、P95 2.00 m、>5m 21 节点
  仅归还陆地区：served 0.84 m vs fresh 0.77 m
  ⇒ **地形瓦片不失真/不因掩膜修正过期**（两条路径的差异是烘焙采样噪声，不是系统性陈旧）；
    "是否重切"不因正确性而必须，只影响可复现性与边界细节。
"""
from __future__ import annotations

import gzip
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform

REPO = Path(__file__).resolve().parents[2]
TERRAIN = REPO / "backend/static/terrain"
# 2026-10-05 统一基准后地形树为椭球高：CUR 必须取椭球件（*_ell.tif，缺省解析口径与
# 07b-post-surface.py 的 default_dem() 一致），否则对比会误报 ~21m 系统性漂移
CUR_ELL = REPO / ".local/dem-work/filled_utm48n_cut_ell.tif"
CUR = CUR_ELL if CUR_ELL.exists() else REPO / ".local/dem-work/filled_utm48n_cut.tif"
OLD = REPO / ".local/dem-work/filled_utm48n_cut.20260830mask.tif"
SAMPLES = 65


def decode(path: Path) -> np.ndarray:
    raw = gzip.decompress(path.read_bytes())
    return np.frombuffer(raw[: SAMPLES * SAMPLES * 2], dtype="<u2").reshape(SAMPLES, SAMPLES).astype(
        float
    ) / 5.0 - 1000.0


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.endswith(".terrain")]
    z, x, y = (int(v) for v in (args[:3] or (12, 6565, 1549)))
    fresh_path = next((Path(a) for a in sys.argv[1:] if a.endswith(".terrain")), None)

    served = decode(TERRAIN / str(z) / str(x) / f"{y}.terrain")
    fresh = decode(fresh_path) if fresh_path else None
    lon_w = -180.0 + x * 360.0 / 2 ** (z + 1)
    lon_e = lon_w + 360.0 / 2 ** (z + 1)
    lat_n = 90.0 - y * 180.0 / 2**z
    lat_s = lat_n - 180.0 / 2**z
    LON, LAT = np.meshgrid(np.linspace(lon_w, lon_e, SAMPLES), np.linspace(lat_n, lat_s, SAMPLES))

    with rasterio.open(CUR) as ds:
        nod = ds.nodata
        xs, ys = warp_transform("EPSG:4326", ds.crs, LON.ravel().tolist(), LAT.ravel().tolist())
        cur = np.array([v[0] for v in ds.sample(list(zip(xs, ys)))]).reshape(
            SAMPLES, SAMPLES
        ).astype(float)
        cur[cur == nod] = 0.0
    with rasterio.open(OLD) as ds2:
        nod2 = ds2.nodata
        xs2, ys2 = warp_transform("EPSG:4326", ds2.crs, LON.ravel().tolist(), LAT.ravel().tolist())
        old = np.array([v[0] for v in ds2.sample(list(zip(xs2, ys2)))]).reshape(
            SAMPLES, SAMPLES
        ).astype(float)
    returned = old == nod2

    def stat(name, arr):
        d = np.abs(arr - cur)
        print(
            f"{name}: 均 |Δ| {d.mean():.2f} m ｜ P95 {np.percentile(d, 95):.2f} m ｜ >5m {int((d > 5).sum())} 节点"
        )
        if returned.any():
            print(f"    仅归还陆地区（{int(returned.sum())} 节点）: 均 |Δ| {d[returned].mean():.2f} m")

    print(f"瓦片 z{z} x{x} y{y} ｜ 节点 {SAMPLES * SAMPLES} ｜ 归还陆地区节点 {int(returned.sum())}")
    stat("served（盘上）", served)
    if fresh is not None:
        stat(f"fresh（{fresh_path.name}）", fresh)


if __name__ == "__main__":
    main()
