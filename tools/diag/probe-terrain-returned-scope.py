"""探针：10-04 掩膜归还陆地区在现役地形树里的影响面（只读）。

回答 A6 ③「是否整树 07 重切」——归还区（旧掩膜 nodata、现 DEM 有效）在
backend/static/terrain 树（49,081 张，z0~z14）里命中多少张瓦片、served 与当前
DEM 差多少；并分「12 区县界内 / 界外」两种口径。

2026-10-05 实测（HEAD d554ecf4 时点）：
- 归还区 = 4,822,464 px = 4,340.2 km²（其中界内 1,211.2 km² = 27.9%）；
- 受影响瓦片：z12 425/36,480（1.2%，全归还 222 / 部分 203）、z11 148、z10 53、
  z9 21、z8 10、…、z13/z14 = 0；
- 界内口径：166 张 z12、归还节点 231,468、served>5m 仅 1,917（0.8%），
  最差瓦片均值 2.56 m ⇒ 研究区内「不因正确性必须重切」，10-04 单瓦片结论可外推；
- 界外口径（越南边境山地）：>5m 占 7.4%；最差 z12 x6542 y1559 均值 18.50 m /
  P95 41 m（845 归还节点中 769 >5m）；>5m 占比 ≥25% 的 34 张、≥50% 的 7 张
  ⇒ 若要动，只重切西侧界外带即可，不必整树。

输入（运行时资产，gitignored）：.local/dem-work/filled_utm48n_cut.tif（现役）与
…20260830mask.tif（旧掩膜）；瓦片树 backend/static/terrain；边界
frontend/public/data/route-analysis/boundary.geojson。
瓦片索引口径：本树 x 列 = 2^(z+1)、y 行 = 2^z（layer.json bounds 105..115/18..25，
z12 盘上 228 列 × 160 行 = 36,480 张，与逐一列目录计数一致）。

用法：python -X utf8 tools/diag/probe-terrain-returned-scope.py
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom
from rasterio.warp import transform as warp_transform

REPO = Path(__file__).resolve().parents[2]
TERRAIN = REPO / "backend/static/terrain"
CUR = REPO / ".local/dem-work/filled_utm48n_cut.tif"
OLD = REPO / ".local/dem-work/filled_utm48n_cut.20260830mask.tif"
BOUNDARY = REPO / "frontend/public/data/route-analysis/boundary.geojson"
SAMPLES = 65


def tile_nodes(z: int, x: int, y: int):
    # 与本树 x 列 2^(z+1) 对齐：lon_w = -180 + x*360/2^(z+1) = -180 + x*180/2^z
    n = 2**z
    lon_w = -180.0 + x * 180.0 / n
    lon_e = lon_w + 180.0 / n
    lat_n = 90.0 - y * 180.0 / n
    lat_s = lat_n - 180.0 / n
    LON, LAT = np.meshgrid(
        np.linspace(lon_w, lon_e, SAMPLES), np.linspace(lat_n, lat_s, SAMPLES)
    )
    return LON, LAT


def decode(path: Path) -> np.ndarray:
    raw = gzip.decompress(path.read_bytes())
    return np.frombuffer(raw[: SAMPLES * SAMPLES * 2], dtype="<u2").reshape(
        SAMPLES, SAMPLES
    ).astype(float) / 5.0 - 1000.0


def main() -> None:
    with rasterio.open(CUR) as ds:
        cur = ds.read(1)
        nod = ds.nodata
        T = ds.transform
        crs = ds.crs
    with rasterio.open(OLD) as ds:
        old = ds.read(1)

    ret = (cur != nod) & (old == nod)
    n_px = int(ret.sum())
    print(f"returned px = {n_px} = {n_px * 0.0009:.1f} km²")

    gj = json.loads(BOUNDARY.read_text(encoding="utf-8"))
    geoms = [transform_geom("EPSG:4326", crs, f["geometry"]) for f in gj["features"]]
    inb = rasterize(
        [(g, 1) for g in geoms],
        out_shape=cur.shape,
        transform=T,
        fill=0,
        dtype="uint8",
        all_touched=False,
    ).astype(bool)
    ret_in = ret & inb
    print(
        f"其中 12 区县界内 = {int(ret_in.sum())} px = {ret_in.sum() * 0.0009:.1f} km² "
        f"（占归还区 {100.0 * ret_in.sum() / max(n_px, 1):.1f}%）"
    )

    rows, cols = np.where(ret)
    stride = max(1, rows.size // 300_000)
    rows, cols = rows[::stride], cols[::stride]
    xs = T.c + (cols + 0.5) * T.a
    ys = T.f + (rows + 0.5) * T.e
    lon, lat = warp_transform(crs, "EPSG:4326", xs.tolist(), ys.tolist())
    lon = np.asarray(lon)
    lat = np.asarray(lat)
    print(f"sample points = {len(lon)}（stride={stride}）")

    all_hits: dict[int, set] = {}
    for z in range(0, 15):
        d = TERRAIN / str(z)
        exist: set = set()
        if d.exists():
            for xd in d.iterdir():
                if xd.is_dir():
                    for f in xd.glob("*.terrain"):
                        exist.add((int(xd.name), int(f.stem)))
        # 树的 x 用 2^(z+1) 列（layer.json bounds 105..115/18..25 + 盘上 228 列实证），
        # y 用 2^z 行 —— 与 probe-terrain-vs-dem.py 的 lon_w/lat_n 公式一致。
        n = 2**z
        tx = np.floor((lon + 180.0) / 360.0 * (n * 2)).astype(np.int64)
        ty = np.floor((90.0 - lat) / 180.0 * n).astype(np.int64)
        uniq = set(zip(tx.tolist(), ty.tolist()))
        hits = uniq & exist
        all_hits[z] = hits
        print(
            f"z{z:>2} | 盘上 {len(exist):>5} 张 | 受影响 {len(hits):>4} 张 "
            f"({100.0 * len(hits) / max(len(exist), 1):.1f}%) | 采样落入 {len(uniq)}"
        )

    # z12 详情
    z = 12
    full = []
    partial = []
    detail = []
    detail_in = []
    for x, y in sorted(all_hits[z]):
        LON, LAT = tile_nodes(z, x, y)
        xs, ys = warp_transform(
            "EPSG:4326", crs, LON.ravel().tolist(), LAT.ravel().tolist()
        )
        xs = np.asarray(xs)
        ys = np.asarray(ys)
        c = np.floor((xs - T.c) / T.a).astype(np.int64)
        r = np.floor((T.f - ys) / (-T.e)).astype(np.int64)
        ok = (r >= 0) & (r < cur.shape[0]) & (c >= 0) & (c < cur.shape[1])
        rr = np.clip(r, 0, cur.shape[0] - 1)
        cc = np.clip(c, 0, cur.shape[1] - 1)
        ok_grid = ok.reshape(SAMPLES, SAMPLES)
        cur_grid = cur[rr, cc].reshape(SAMPLES, SAMPLES)
        old_grid = old[rr, cc].reshape(SAMPLES, SAMPLES)
        valid_grid = (cur_grid != nod) & ok_grid
        ret_grid = valid_grid & (old_grid == nod)
        n_ret = int(ret_grid.sum())
        n_valid = int(valid_grid.sum())
        if n_valid and n_ret == n_valid:
            full.append((x, y))
        elif n_ret > 0:
            partial.append((x, y))
        served = decode(TERRAIN / str(z) / str(x) / f"{y}.terrain")
        diff = np.abs(served - cur_grid.astype(float))
        m = ret_grid
        if m.any():
            d = diff[m]
            p95 = float(np.percentile(d, 95))
            gt5 = int((d > 5.0).sum())
            detail.append((x, y, float(d.mean()), p95, gt5, n_valid, n_ret))
        inb_grid = inb[rr, cc].reshape(SAMPLES, SAMPLES) & ok_grid
        m_in = ret_grid & inb_grid
        if m_in.any():
            d_in = diff[m_in]
            detail_in.append(
                (
                    x,
                    y,
                    float(d_in.mean()),
                    float(np.percentile(d_in, 95)),
                    int((d_in > 5.0).sum()),
                    int(m_in.sum()),
                )
            )

    print(f"\nz12 受影响的盘上瓦片 = {len(all_hits[z])}：全归还 {len(full)} / 部分 {len(partial)}")
    print("tile | meanΔ | P95 | >5m节点 | 有效节点 | 归还节点")
    for x, y, mean, p95, gt5, n_valid, n_ret in sorted(detail, key=lambda t: -t[2]):
        tag = "FULL" if (x, y) in set(full) else "part"
        print(
            f"z12 x{x} y{y} [{tag}] | {mean:.2f} | {p95:.1f} | {gt5} | {n_valid} | {n_ret}"
        )
    worst = [t for t in detail if t[4] > 100]
    print(f"\n>5m 节点 >100 的瓦片数 = {len(worst)} / {len(detail)}")
    tot_ret = sum(t[6] for t in detail)
    tot_gt5 = sum(t[4] for t in detail)
    if tot_ret:
        print(
            f"受影响瓦片归还区节点合计 = {tot_ret}｜其中 served>5m = {tot_gt5} "
            f"({100.0 * tot_gt5 / tot_ret:.1f}%)"
        )
    for lo, hi in ((0, 1), (1, 10), (10, 25), (25, 50), (50, 101)):
        c = sum(1 for t in detail if lo <= 100.0 * t[4] / max(t[6], 1) < hi)
        print(f">5m 节点占比 [{lo}%,{hi}%) 的瓦片 = {c}")
    if full:
        xs_ = [t[0] for t in full]
        ys_ = [t[1] for t in full]
        print(f"全归还瓦片 x 范围 {min(xs_)}~{max(xs_)} / y 范围 {min(ys_)}~{max(ys_)}")
    print("\n--- 12 区县界内口径 ---")
    print(f"界内受影响的盘上 z12 瓦片 = {len(detail_in)}")
    if detail_in:
        tot_in = sum(t[5] for t in detail_in)
        gt5_in = sum(t[4] for t in detail_in)
        print(
            f"界内归还节点合计 = {tot_in}｜served>5m = {gt5_in} "
            f"({100.0 * gt5_in / tot_in:.1f}%)"
        )
        print("界内最差 10 张（tile | meanΔ | P95 | >5m | 界内归还节点）")
        for x, y, mean, p95, gt5, n in sorted(detail_in, key=lambda t: -t[2])[:10]:
            print(f"z12 x{x} y{y} | {mean:.2f} | {p95:.1f} | {gt5} | {n}")


if __name__ == "__main__":
    main()
