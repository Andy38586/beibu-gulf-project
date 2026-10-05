#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""07c —— 用「工程后地表」重切受影响的 terrain 瓦片，并把 maxzoom 提到 14。

为什么必须加密：渠槽底宽仅 80 m，而 z12 的网格间距约 70 m ⇒ 渠槽被欠采样，
实测锚点处读到 43.5 m（真实渠底 24.7 m）。加密到 z14（17 m 网格）后误差收到
1.98 / 2.31 / 3.38 m。

行为：只重写与三枢纽 footprint 相交的瓦片（z0–14），其余逐字节不动；
      同时重算 childTileMask（父瓦片必须指向真实存在的子瓦片，否则 Cesium 不细化）；
      layer.json 的 maxzoom 提到 14 并追加 z13/z14 的 available 区间。

⚠ `backend/static/terrain/` 在 .gitignore:161 内（整棵树不入库）—— 重跑本脚本前请先确认
   是否要保留既有挖方；备份见 `.local/926-rebake/backup-orig-terrain/`。
"""
from __future__ import annotations
import gzip, json, math, sys
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.windows import from_bounds

REPO = Path(__file__).resolve().parents[2]
TERRAIN = REPO / "backend/static/terrain"
POST = REPO / ".local/926-rebake/post_surface_utm48n.tif"
SAMPLES, ENC_OFFSET, ENC_SCALE, MAXZ = 65, 1000.0, 5.0, 14
# (lon, lat, bearing, x0, x1, half_w) —— 轴向范围 = 模型渠槽实测范围（非对称）
FOOT = {"madao": (108.93922, 22.44632, 198.0, -1478.0, 801.0, 305.0),
        "qishi": (108.94146, 22.32265, 182.0, -687.0, 1003.0, 349.0),
        "qingnian": (108.65500, 22.01020, 190.0, -438.0, 817.0, 292.0)}


def tb(z, x, y):
    cols, rows = 2 ** (z + 1), 2 ** z
    return (-180.0 + x * 360.0 / cols, 90.0 - (y + 1) * 180.0 / rows,
            -180.0 + (x + 1) * 360.0 / cols, 90.0 - y * 180.0 / rows)


def main():
    DRY = "--dry-run" in sys.argv
    post_path = POST
    if "--post" in sys.argv:
        post_path = Path(sys.argv[sys.argv.index("--post") + 1])
    if "--terrain" in sys.argv:
        global TERRAIN
        TERRAIN = Path(sys.argv[sys.argv.index("--terrain") + 1])
    canal_path = None
    if "--canal-line" in sys.argv:
        canal_path = Path(sys.argv[sys.argv.index("--canal-line") + 1])
    print(f"[07c] post={post_path} terrain={TERRAIN}" + (" [dry-run]" if DRY else ""), flush=True)
    layer = json.loads((TERRAIN / "layer.json").read_text(encoding="utf-8"))
    # have 一律取**盘上实清单**：旧实现从 layer.json.available 反推，会把历史超声明带进来
    # （2026-10-04 实测：z13 声明 48/实物 12、z14 声明 56/实物 16，多出的 76 张永远 404）。
    have = set()
    for p in TERRAIN.rglob("*.terrain"):
        q = p.relative_to(TERRAIN).parts
        if len(q) == 3:
            have.add((int(q[0]), int(q[1]), int(q[2][: -len(".terrain")])))
    base = len(have)
    boxes = []
    for hub, (lon, lat, br, xa, xb, hw) in FOOT.items():
        mlon = 111412.84 * math.cos(math.radians(lat)); mlat = 111132.9
        b = math.radians(br); pts = []
        for xs in (xa, xb):
            for dd in (-hw, hw):
                E = xs * math.sin(b) + dd * math.cos(b); N = xs * math.cos(b) - dd * math.sin(b)
                pts.append((lon + E / mlon, lat + N / mlat))
        boxes.append((min(p[0] for p in pts), min(p[1] for p in pts),
                      max(p[0] for p in pts), max(p[1] for p in pts)))
    new = set()
    for z in (13, 14):
        cols, rows = 2 ** (z + 1), 2 ** z
        for w, s, e, n in boxes:
            x0 = int((w + 180.0) / 360.0 * cols) - 1; x1 = int((e + 180.0) / 360.0 * cols) + 1
            y0 = int((90.0 - n) / 180.0 * rows) - 1; y1 = int((90.0 - s) / 180.0 * rows) + 1
            for x in range(max(0, x0), min(cols - 1, x1) + 1):
                for y in range(max(0, y0), min(rows - 1, y1) + 1):
                    new.add((z, x, y))
    planned = have | new
    print(f"盘上原瓦片 {base} 张；bbox 计划新增 z13/z14 {len(new)} 张 → 计划集 {len(planned)}")
    # ===== 运河走廊：沿全线补 z13/z14 瓦片，并重切走廊内全部层级（2026-10-05）=====
    corridor_tiles = set()
    if canal_path:
        line = json.loads(canal_path.read_text(encoding="utf-8"))["points"]
        for z in (13, 14):
            cols, rows = 2 ** (z + 1), 2 ** z
            for p in line:
                x = int((p["lon"] + 180.0) / 360.0 * cols)
                y = int((90.0 - p["lat"]) / 180.0 * rows)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        if 0 <= x + dx < cols and 0 <= y + dy < rows:
                            corridor_tiles.add((z, x + dx, y + dy))
        new |= corridor_tiles
        planned = have | new
        print(f"运河走廊：补 z13/z14 {len(corridor_tiles)} 张（含 ±1 邻域）")
    targets = set()
    for z, x, y in planned:
        tw, ts, te, tn = tb(z, x, y)
        for w, s, e, n in boxes:
            if te > w and tw < e and tn > s and ts < n:
                targets.add((z, x, y)); break
    # 走廊瓦片 + 其全部祖先（父瓦片同样要按新地表重采样）
    for z, x, y in corridor_tiles:
        targets.add((z, x, y))
        zz, xx, yy = z, x, y
        while zz > 0:
            zz, xx, yy = zz - 1, xx >> 1, yy >> 1
            targets.add((zz, xx, yy))
    # 实写集 = 盘上原有 ∪ 真正新建的（targets∩new）——available 与 childTileMask 都必须按它写，
    # 按计划集写会声明出永远不存在的瓦片（本次修的就是这条）。
    have = have | (targets & new)
    print(f"需重写/新建 {len(targets)} 张；实写后应有 {len(have)} 张（z13/z14 {len(have & new)}）")

    raw = rasterio.open(post_path)
    dem = raw if raw.crs.to_epsg() == 4326 else WarpedVRT(raw, crs="EPSG:4326", resampling=Resampling.bilinear)
    nodata = raw.nodata if raw.nodata is not None else -32768.0
    db = dem.bounds
    written = changed = 0
    for z, x, y in sorted(targets):
        lon_w, lat_s, lon_e, lat_n = tb(z, x, y)
        sl = (lat_n - lat_s) / (SAMPLES - 1); so = (lon_e - lon_w) / (SAMPLES - 1)
        j0 = max(0, math.ceil((db.left - lon_w) / so)); j1 = min(SAMPLES - 1, math.floor((db.right - lon_w) / so))
        i0 = max(0, math.ceil((lat_n - db.top) / sl)); i1 = min(SAMPLES - 1, math.floor((lat_n - db.bottom) / sl))
        h = np.zeros((SAMPLES, SAMPLES))
        if j1 >= j0 and i1 >= i0:
            win = from_bounds(lon_w + j0 * so, lat_n - i1 * sl, lon_w + j1 * so, lat_n - i0 * sl, transform=dem.transform)
            sub = dem.read(1, window=win, out_shape=(i1 - i0 + 1, j1 - j0 + 1), resampling=Resampling.bilinear).astype(np.float64)
            h[i0:i1 + 1, j0:j1 + 1] = np.where((sub == nodata) | ~np.isfinite(sub), 0.0, sub)
        enc = np.clip((h + ENC_OFFSET) * ENC_SCALE, 0, 65535).astype("<u2")
        mask = 0
        for bit, (cx, cy) in ((0, (2 * x, 2 * y + 1)), (1, (2 * x + 1, 2 * y + 1)),
                              (2, (2 * x, 2 * y)), (3, (2 * x + 1, 2 * y))):
            if (z + 1, cx, cy) in have:
                mask |= 1 << bit
        # mtime=0：gzip 头不带当前时间 ⇒ 同内容同字节（与 08 同款确定性约定）
        payload = gzip.compress(enc.tobytes() + bytes([mask]) + bytes([0]), mtime=0)
        out = TERRAIN / str(z) / str(x) / ("%d.terrain" % y)
        old = out.read_bytes() if out.exists() else b""
        if old != payload:
            changed += 1
            if not DRY:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(payload)
        written += 1
    print(f"{'[dry-run] 计划写' if DRY else '写'} {written} 张（内容变化 {changed}）")

    # layer.json：maxzoom → 14，available 追加 z13/z14
    by = {}
    for tz, tx, ty in have:
        by.setdefault(tz, {}).setdefault(tx, []).append(ty)
    avail = []
    for tz in range(0, MAXZ + 1):
        rows = 2 ** tz; rng = []
        for tx in sorted(by.get(tz, {})):
            ys = sorted(by[tz][tx]); st = prev = ys[0]
            for yy in ys[1:] + [None]:
                if yy is None or yy != prev + 1:
                    rng.append({"startX": tx, "startY": rows - 1 - prev, "endX": tx, "endY": rows - 1 - st})
                    if yy is not None: st = yy
                if yy is not None: prev = yy
        avail.append(rng)
    layer["maxzoom"] = MAXZ
    layer["available"] = avail
    if not DRY:
        (TERRAIN / "layer.json").write_text(json.dumps(layer, ensure_ascii=False, indent=2), encoding="utf-8")
    n13 = sum((r["endX"] - r["startX"] + 1) * (abs(r["endY"] - r["startY"]) + 1) for r in avail[13])
    n14 = sum((r["endX"] - r["startX"] + 1) * (abs(r["endY"] - r["startY"]) + 1) for r in avail[14])
    print(f"{'[dry-run] ' if DRY else ''}layer.json: maxzoom={MAXZ}，z13 声明 {n13} 张"
          f"（{len(avail[13])} 区间）/ z14 声明 {n14} 张（{len(avail[14])} 区间）")


if __name__ == "__main__":
    main()
