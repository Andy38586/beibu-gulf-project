# -*- coding: utf-8 -*-
"""14-bathy-fuse.py — 近岸测深交付件：验收 → 垂直基准换算 → 融合进海侧工作格网。

定位与红线（正本：`docs/近岸测深数据需求-2026-10-04.md` §二/§三，不在此复述数值口径）：
  · 数据来源声明（--source）与垂直基准声明（--datum）**缺一即拒收**（§三-4）；
  · 分辨率 ≤100 m（§二）；覆盖必须与 P0 区（钦州港航道/茅尾海/龙门水道）相交（§一）；
  · 垂直基准二选一（§二核心条款）：
      --datum egm96            交付已换算为 EGM96 正高（水面下为负）⇒ 直接采用；
      --datum lld --lld-height-m Z
                               交付为理论最低潮面水深 d>0，Z = 该基准面在 EGM96
                               下的高度（负值）⇒ h = Z − d。
  任何一项不过 ⇒ 非零退出，不产出文件（--check 与融合模式同一套判据）。

输出只写 .local（新海侧网格 + JSON 报告）。`backend/data/flood/dem/` 与
`backend/static/` 属运行时资产，本脚本**只打印**后续命令，不代跑（写资产须用户点头）。

用法（venv python）：
  # 只验收（不写盘）
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 \
    tools/dem-pipeline/14-bathy-fuse.py <bathy.tif|csv> --source "<出处>" --datum egm96 --check
  # 验收 + 融合（输出新海侧网格与差异报告）
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 \
    tools/dem-pipeline/14-bathy-fuse.py <bathy> --source "<出处>" --datum lld \
    --lld-height-m -4.3 --out .local/dem-sea-work/sea_custom_<源>.tif \
    --report .local/dem-sea-work/bathy-fuse-report.json
  # 仅计算不写盘：同上加 --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject
from rasterio.warp import transform as warp_transform
from rasterio.warp import transform_bounds

try:
    from scipy.interpolate import griddata
    from scipy.spatial import cKDTree
except ImportError:  # 点云（CSV）交付需要 scipy；网格（GeoTIFF）交付不需要
    griddata = None
    cKDTree = None

REPO = Path(__file__).resolve().parents[2]
DEFAULT_SEA = REPO / '.local/dem-sea-work/sea_custom.tif'

# 以下三项的数值口径全部来自需求书，改这里必须同步改正本
P0_BOX = (108.45, 21.55, 108.85, 21.85)  # §一 P0：钦州港航道 + 茅尾海 + 龙门水道
MAX_RES_M = 100.0  # §二 分辨率
NAME_RE = re.compile(r'^bathy_.+_\d+m?_.+\.(tif|tiff|csv)$', re.I)  # §二 命名（提示性，不判红）

DEPTH_BANDS = ((0, 5), (5, 10), (10, 20), (20, 50))  # §三-2 要 0~20m 分带，20~50 顺带


class Reject(Exception):
    """验收红线不通过（来源/基准/分辨率/覆盖/CRS）——统一映射为 exit 2，不产出任何文件。"""


def md5_of(path: Path) -> str:
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fmt(v, nd=3):
    if v is None:
        return 'n/a'
    v = float(v)
    return 'n/a' if not math.isfinite(v) else ('%.*f' % (nd, v))


def ints(v):
    return '{:,}'.format(int(v))


def resolution_m(crs, tr, height) -> float:
    """格网分辨率（米）。地理坐标按中心纬度近似换算——只用于 ≤100m 的量级判据。"""
    rx, ry = abs(tr.a), abs(tr.e)
    if crs is not None and crs.is_geographic:
        lat = tr.f + tr.e * height / 2.0
        mx = 111320.0 * math.cos(math.radians(lat))
        my = 110574.0
        return max(rx * mx, ry * my)
    return max(rx, ry)


def read_csv_points(path: Path, src_crs: str):
    """CSV（lng,lat,depth_m，需求书 §二 格式）→ 点表。列名宽容匹配。"""
    raw = np.genfromtxt(path, delimiter=',', names=True, dtype=None, encoding='utf-8')
    if raw is None or raw.dtype.names is None:
        raise Reject('❌ CSV 无法解析出表头（要求 lng,lat,depth_m）')
    names = {n.lower(): n for n in raw.dtype.names}

    def pick(*cands):
        for c in cands:
            if c in names:
                return names[c]
        return None

    cx = pick('lng', 'lon', 'x', 'longitude')
    cy = pick('lat', 'y', 'latitude')
    cz = pick('depth_m', 'depth', 'z', 'value')
    if not (cx and cy and cz):
        raise Reject('❌ CSV 缺列：需要 lng/lat/depth_m（实际表头 %s）' % ','.join(raw.dtype.names))
    xs = np.atleast_1d(raw[cx]).astype('float64')
    ys = np.atleast_1d(raw[cy]).astype('float64')
    vs = np.atleast_1d(raw[cz]).astype('float64')
    keep = np.isfinite(xs) & np.isfinite(ys) & np.isfinite(vs)
    if keep.sum() == 0:
        raise Reject('❌ CSV 无有效点')
    return dict(kind='points', xs=xs[keep], ys=ys[keep], values=vs[keep].astype('float32'),
                crs=src_crs, path=path)


def read_bathy(path: Path, src_crs: str):
    if path.suffix.lower() in ('.csv', '.txt'):
        return read_csv_points(path, src_crs)
    with rasterio.open(path) as ds:
        if ds.crs is None:
            raise Reject('❌ 栅格无 CRS——水平基准未声明，按 §三-4 拒收')
        arr = ds.read(1).astype('float32')
        nod = ds.nodata
        bad = ~np.isfinite(arr)
        if nod is not None and np.isfinite(nod):
            bad |= (arr == np.float32(nod))
        arr[bad] = np.nan
        return dict(kind='grid', arr=arr, crs=ds.crs, transform=ds.transform,
                    bounds=ds.bounds, width=ds.width, height=ds.height,
                    res_m=resolution_m(ds.crs, ds.transform, ds.height),
                    nodata_declared=(nod is not None), path=path)


def bounds_4326(src) -> tuple:
    if src['kind'] == 'grid':
        return tuple(transform_bounds(src['crs'], 'EPSG:4326', *src['bounds']))
    xs, ys = warp_transform(src['crs'], 'EPSG:4326', src['xs'], src['ys'])
    return (float(np.min(xs)), float(np.min(ys)), float(np.max(xs)), float(np.max(ys)))


def coverage_p0(b4326) -> tuple:
    x0, y0, x1, y1 = b4326
    ix0, iy0 = max(x0, P0_BOX[0]), max(y0, P0_BOX[1])
    ix1, iy1 = min(x1, P0_BOX[2]), min(y1, P0_BOX[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0, None
    frac = ((ix1 - ix0) * (iy1 - iy0)) / ((P0_BOX[2] - P0_BOX[0]) * (P0_BOX[3] - P0_BOX[1]))
    return frac, (ix0, iy0, ix1, iy1)


def convert_datum(values, datum: str, lld_height_m):
    if datum == 'egm96':
        return values
    return (lld_height_m - values).astype('float32')


def to_target_grid(src, sea_crs, sea_transform, width, height, cell_m, max_fill_gap_m):
    """把交付件投到目标格网（float32/NaN）。网格走 reproject，点云走 griddata + cKDTree 回退。"""
    dst = np.full((height, width), np.nan, dtype='float32')
    if src['kind'] == 'grid':
        reproject(source=src['arr'], destination=dst,
                  src_transform=src['transform'], src_crs=src['crs'],
                  dst_transform=sea_transform, dst_crs=sea_crs,
                  src_nodata=np.nan, dst_nodata=np.nan,
                  resampling=Resampling.bilinear)
        return dst
    if griddata is None:
        raise Reject('❌ CSV 点云交付需要 scipy（本 venv 应自带；缺则改用 GeoTIFF 交付）')
    # warp_transform 返回的是 list（不是 ndarray）——先转数组再算像素坐标
    xs, ys = (np.asarray(v, dtype='float64')
              for v in warp_transform(src['crs'], sea_crs, src['xs'], src['ys']))
    inv = ~sea_transform
    # 不用 Affine*(xs,ys)：affine 的 __mul__ 对数组序列会抛 TypeError（实测）
    cols = inv.a * xs + inv.b * ys + inv.c
    rows = inv.d * xs + inv.e * ys + inv.f
    c0 = max(0, int(math.floor(np.min(cols))) - 2)
    c1 = min(width - 1, int(math.ceil(np.max(cols))) + 2)
    r0 = max(0, int(math.floor(np.min(rows))) - 2)
    r1 = min(height - 1, int(math.ceil(np.max(rows))) + 2)
    if c1 < c0 or r1 < r0:
        return dst
    rr, cc = np.mgrid[r0:r1 + 1, c0:c1 + 1]
    pts = np.column_stack([cols, rows])
    query = np.column_stack([cc.ravel().astype('float64'), rr.ravel().astype('float64')])
    vals = src['values']
    if len(vals) >= 3:
        lin = griddata(pts, vals, query, method='linear')
    else:
        lin = np.full(len(query), np.nan)
    tree = cKDTree(pts)
    dist, idx = tree.query(query)
    max_gap_px = max_fill_gap_m / max(cell_m, 1e-6)
    nearest = vals[idx]
    filled = np.where(np.isfinite(lin), lin,
                      np.where(dist <= max_gap_px, nearest, np.nan))
    dst[r0:r1 + 1, c0:c1 + 1] = filled.reshape(rr.shape).astype('float32')
    return dst


def band_stats(depth_old, delta):
    out = []
    for lo, hi in DEPTH_BANDS:
        m = (depth_old >= lo) & (depth_old < hi)
        n = int(m.sum())
        out.append(dict(band='%d-%dm' % (lo, hi), n=n,
                        median_delta=float(np.median(delta[m])) if n else None,
                        mean_abs_delta=float(np.mean(np.abs(delta[m]))) if n else None))
    m = depth_old >= DEPTH_BANDS[-1][1]
    out.append(dict(band='>%dm' % DEPTH_BANDS[-1][1], n=int(m.sum()),
                    median_delta=float(np.median(delta[m])) if m.any() else None,
                    mean_abs_delta=float(np.mean(np.abs(delta[m]))) if m.any() else None))
    return out


def parse_args(argv):
    ap = argparse.ArgumentParser(
        description='近岸测深交付件：验收 → 基准换算 → 融合（口径见 docs/近岸测深数据需求-2026-10-04.md）')
    ap.add_argument('bathy', help='交付件：GeoTIFF 网格 或 CSV(lng,lat,depth_m)')
    ap.add_argument('--source', required=False, help='数据出处声明（缺失即拒收，§三-4）')
    ap.add_argument('--datum', choices=['egm96', 'lld'], help='垂直基准（缺失即拒收，§二）')
    ap.add_argument('--lld-height-m', type=float, default=None,
                    help='理论最低潮面在 EGM96 下的高度 Z（负值）；--datum lld 时必填')
    ap.add_argument('--src-crs', default='EPSG:4326',
                    help='CSV 的水平基准（默认 EPSG:4326，可填 EPSG:4490）')
    ap.add_argument('--sea', default=str(DEFAULT_SEA),
                    help='现役海侧工作格网（默认 .local/dem-sea-work/sea_custom.tif）')
    ap.add_argument('--out', default=None, help='融合后的新海侧网格（写盘必填；不得等于 --sea 原位覆盖）')
    ap.add_argument('--report', default=None, help='差异报告 JSON（可选）')
    ap.add_argument('--max-fill-gap-m', type=float, default=60.0,
                    help='点云交付的最大回填距离（米，默认 60 = 2×30m 工作格网；只影响 CSV）')
    ap.add_argument('--check', action='store_true', help='只验收，不融合不写盘')
    ap.add_argument('--dry-run', action='store_true', help='验收 + 计算，不写盘')
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    bathy_path = Path(args.bathy)
    if not bathy_path.exists():
        print('❌ 交付件不存在：%s' % bathy_path)
        return 2
    if not args.source or not str(args.source).strip():
        print('❌ 缺 --source（数据出处声明）——按 §三-4 拒收：来源与基准声明缺一即拒收')
        return 2
    if not args.datum:
        print('❌ 缺 --datum（垂直基准声明）——按 §三-4 拒收：来源与基准声明缺一即拒收')
        return 2
    if args.datum == 'lld' and args.lld_height_m is None:
        print('❌ --datum lld 必须给 --lld-height-m Z（该基准面在 EGM96 下的高度，负值）')
        return 2
    if args.datum == 'lld' and args.lld_height_m is not None and args.lld_height_m >= 0:
        print('⚠ --lld-height-m=%s ≥ 0：理论最低潮面通常低于 EGM96 零面（应为负值），请核对基准资料'
              % fmt(args.lld_height_m, 2))

    try:
        src = read_bathy(bathy_path, args.src_crs)
    except Reject as exc:
        print(str(exc))
        return 2
    if src['kind'] == 'grid' and src['res_m'] > MAX_RES_M:
        print('❌ 分辨率 %.1f m > 需求书 §二 上限 %.0f m ⇒ 拒收（现海侧 SRTM15+ 460m，升级需更密）'
              % (src['res_m'], MAX_RES_M))
        return 2
    b4326 = bounds_4326(src)
    frac, inter = coverage_p0(b4326)
    if frac <= 0.0:
        print('❌ 覆盖与 P0 区（钦州港航道+茅尾海+龙门水道）零相交 ⇒ 拒收；'
              '本件范围 %.4f~%.4f E / %.4f~%.4f N' % b4326)
        return 2
    if src['kind'] == 'grid':
        valid, total = int(np.isfinite(src['arr']).sum()), src['arr'].size
    else:
        valid, total = len(src['values']), len(src['values'])
    values = src['values'] if src['kind'] == 'points' else src['arr']
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        print('❌ 交付件无任何有效值')
        return 2
    vmin, vmed, vmax = float(finite.min()), float(np.median(finite)), float(finite.max())
    pos_frac = float((finite > 0).mean())

    print('== 验收（需求书 §二/§三）==')
    print('文件          %s' % bathy_path)
    print('来源声明      %s' % args.source)
    print('垂直基准      %s%s' % (args.datum,
          '' if args.datum == 'egm96' else '（Z = %s m，h = Z − d）' % fmt(args.lld_height_m, 2)))
    print('类型/分辨率   %s' % src['kind'])
    if src['kind'] == 'grid':
        print('分辨率        %.1f m（≤%.0f ✓）' % (src['res_m'], MAX_RES_M))
    print('覆盖（P0 区） %.2f%% ｜ 交集 %.4f~%.4f E / %.4f~%.4f N'
          % (frac * 100.0, inter[0], inter[2], inter[1], inter[3]))
    print('有效值        %s / %s（%.1f%%）｜ 值域 %s … %s（中位 %s）｜ >0 占比 %.1f%%'
          % (ints(valid), ints(total), 100.0 * valid / max(total, 1), fmt(vmin, 2), fmt(vmax, 2),
             fmt(vmed, 2), pos_frac * 100.0))
    if not NAME_RE.match(bathy_path.name):
        print('⚠ 命名不符 §二 规范 bathy_<来源>_<分辨率m>_<垂直基准>.<ext>（提示，不判红）')
    if args.datum == 'egm96' and pos_frac > 0.5:
        print('⚠ egm96 口径下 >0 值占 %.1f%%：水面以上读数偏多，核对是否已按 EGM96 正高交付'
              % (pos_frac * 100.0))
    print('✅ 验收通过（来源/基准声明齐全、分辨率与覆盖达标）')
    if args.check:
        return 0

    sea_path = Path(args.sea)
    if not sea_path.exists():
        print('❌ 缺现役海侧格网 %s（先跑 tools/dem-pipeline/09b-srtm15-sea-grid.ps1）' % sea_path)
        return 2
    if not args.out:
        print('❌ 融合模式必须给 --out（新海侧网格输出路径；不得原位覆盖 --sea）')
        return 2
    out_path = Path(args.out)
    if out_path.resolve() == sea_path.resolve():
        print('❌ --out 不得等于 --sea（不做原位覆盖，保留可回退原件）')
        return 2

    with rasterio.open(sea_path) as ds:
        sea = ds.read(1).astype('float32')
        sea_crs, sea_tr, width, height = ds.crs, ds.transform, ds.width, ds.height
        profile = ds.profile.copy()
    src_h = convert_datum(values, args.datum, args.lld_height_m).astype('float32')
    if src['kind'] == 'points':
        src['values'] = src_h
    else:
        src['arr'] = src_h
    cell_m = resolution_m(sea_crs, sea_tr, height)
    print('== 融合 ==')
    print('目标格网      %s（%d×%d，格网 %sm）' % (sea_path, width, height, fmt(cell_m, 0)))
    try:
        on_grid = to_target_grid(src, sea_crs, sea_tr, width, height, cell_m, args.max_fill_gap_m)
    except Reject as exc:
        print(str(exc))
        return 2
    covered = np.isfinite(on_grid)
    sea_valid = np.isfinite(sea)
    usable = covered & sea_valid
    skipped_land = int((covered & ~sea_valid).sum())
    n_use = int(usable.sum())
    if n_use == 0:
        print('❌ 交付件与现役海侧格网无重叠有效格 ⇒ 不产出（核对水平基准/范围）')
        return 2
    old_vals = sea[usable]
    new_vals = on_grid[usable]
    delta = new_vals - old_vals
    depth_old = -old_vals
    stats = dict(
        covered_cells=int(covered.sum()), replaced_cells=n_use,
        skipped_land_cells=skipped_land,
        delta_median=float(np.median(delta)), delta_mean=float(np.mean(delta)),
        delta_p95_abs=float(np.percentile(np.abs(delta), 95)),
        delta_max_abs=float(np.max(np.abs(delta))),
        bands=band_stats(depth_old, delta),
    )
    print('覆盖格        %s（占海侧有效格 %.2f%%）｜替换 %s ｜落在现役非海区（跳过）%s'
          % (ints(stats['covered_cells']), 100.0 * n_use / max(int(sea_valid.sum()), 1),
             ints(n_use), ints(skipped_land)))
    print('差异 Δ=h新−h旧 中位 %s ｜ 均值 %s ｜ P95|Δ| %s ｜ max|Δ| %s'
          % (fmt(stats['delta_median']), fmt(stats['delta_mean']),
             fmt(stats['delta_p95_abs']), fmt(stats['delta_max_abs'])))
    for b in stats['bands']:
        print('  水深 %-7s n=%s ｜ 中位Δ %s ｜ 均|Δ| %s'
              % (b['band'], ints(b['n']), fmt(b['median_delta']), fmt(b['mean_abs_delta'])))

    sea[usable] = new_vals
    report = dict(
        bathy=str(bathy_path), bathy_md5=md5_of(bathy_path),
        source=args.source, datum=args.datum, lld_height_m=args.lld_height_m,
        sea=str(sea_path), sea_md5=md5_of(sea_path),
        coverage_p0=frac, bounds_4326=list(b4326), **stats,
    )
    if args.dry_run:
        print('（dry-run：未写盘）')
    else:
        profile.update(dtype='float32', nodata=float('nan'))
        with rasterio.open(out_path, 'w', **profile) as dst:
            dst.write(sea, 1)
        report['out'] = str(out_path)
        report['out_md5'] = md5_of(out_path)
        print('WROTE %s' % out_path)
        if args.report:
            Path(args.report).parent.mkdir(parents=True, exist_ok=True)
            Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                         encoding='utf-8')
            print('WROTE %s' % args.report)
    target = '<新海侧网格>' if args.dry_run else str(out_path)
    print('== 后续（写运行时资产，须用户点头后执行）==')
    print(r"& 'C:\Program Files\QGIS 3.44.12\apps\Python312\python.exe' -X utf8 "
          r"tools/dem-pipeline/10-landsea-merge.py .local/dem-work/filled_utm48n_cut.tif "
          r"%s backend/data/flood/dem/landsea_utm48n.tif" % target)
    print(r"& 'C:\Program Files\QGIS 3.44.12\apps\Python312\python.exe' -X utf8 "
          r"tools/dem-pipeline/11-seam-audit.py .local/dem-work/filled_utm48n_cut.tif "
          r"%s backend/data/flood/dem/landsea_utm48n.tif" % target)
    print('# 期望：11 的两侧中位差仍为 -3.00m 量级（岸坡）、陆侧台阶 0.00m；'
          '不为 0 ⇒ 融合破坏接缝，按未通过记')
    return 0


if __name__ == '__main__':
    sys.exit(main())
