# -*- coding: utf-8 -*-
"""probe-hub-heights.py — 三枢纽/运河带/港区模型绝对高程 vs 平的底图面（椭球 0 m）与统一 DEM（EGM96 正高）。只读。

用途：回答「模型关掉真地形后到底悬在什么高度、和交付 DEM 差多少」——地形 ↔ 3D Tiles 互斥保留后，
模型自身的高程基准是唯一落位依据（见 docs/3dtiles-改造任务表.md §8.19）。
用法（venv，需 numpy/rasterio）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 tools/diag/probe-hub-heights.py
  # 可选：与运行时 Cesium 对账 —— --sphere <uri>（打印 glTF 盒中心/复合变换链，浏览器侧同点应同一行）
"""
import json, os, math, struct, sys
import numpy as np
import rasterio
from rasterio.warp import transform as wtransform

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
A_, F = 6378137.0, 1 / 298.257223563
E2 = F * (2 - F)


def read_glb(p):
    b = open(p, 'rb').read()
    off, js, bin_ = 12, None, None
    while off + 8 <= len(b):
        ln, ty = struct.unpack_from('<II', b, off)
        d = b[off + 8:off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(d)
        elif ty == 0x004E4942:
            bin_ = d
        off += 8 + ln + ((4 - ln % 4) % 4)
    return js, bin_


CS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def acc(j, b, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    fmt, sz = CS[a['componentType']]
    nc = NC[a['type']]
    st = bv.get('byteStride') or sz * nc
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(b, dtype=np.dtype('<' + fmt), count=a['count'] * nc, offset=base)
    if st == sz * nc:
        return arr.reshape(a['count'], nc)
    return np.array(np.lib.stride_tricks.as_strided(arr, shape=(a['count'], nc), strides=(st, sz)))


def mul(a, b):
    o = [0.0] * 16
    for i in range(4):
        for j in range(4):
            o[i * 4 + j] = sum(a[k * 4 + j] * b[i * 4 + k] for k in range(4))
    return o


def ap(m, p):
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]


def ecef2llh(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    lng = np.degrees(np.arctan2(y, x))
    p2 = np.hypot(x, y)
    lat = np.arctan2(z, p2 * (1 - E2))
    for _ in range(10):
        Nn = A_ / np.sqrt(1 - E2 * np.sin(lat) ** 2)
        h = p2 / np.cos(lat) - Nn
        lat = np.arctan2(z, p2 * (1 - E2 * Nn / (Nn + h)))
    Nn = A_ / np.sqrt(1 - E2 * np.sin(lat) ** 2)
    h = p2 / np.cos(lat) - Nn
    return lng, np.degrees(lat), h


def pt2llh(p):
    lng, lat, h = ecef2llh(np.array([p], dtype=np.float64))
    return lng[0], lat[0], h[0]


TILES = os.path.join(ROOT, 'backend/static/pinglu/tiles')
ts = json.load(open(os.path.join(TILES, 'tileset.json'), encoding='utf-8'))
rootT = ts['root']['transform']
rl, ra, rh = pt2llh(rootT[12:15])
print('root 原点：%.6f, %.6f 椭球高 %.1f m' % (rl, ra, rh))

HUBS = ('madao', 'qishi', 'qingnian')
# 全线走廊/桥梁另立两桶：它们与枢纽是否同处一个竖直基准，是本轮要答的问题之一
BUCKETS = HUBS + ('corridor', 'bridges')
data = {h: {} for h in BUCKETS}
# 逐顶点 DEM 差用：每桶抽稀后的 (lon, lat, h_ellipsoid)
samples = {h: [] for h in BUCKETS}
# 逐 uri × 材质的高度（用于看走廊带是否按真实设计水位分档）
per_uri = {}
centers = {}


def walk(node, M):
    Wm = mul(M, node['transform']) if node.get('transform') else M
    uri = (node.get('content') or {}).get('uri') or ''
    if uri and node.get('boundingVolume', {}).get('box'):
        bb = node['boundingVolume']['box']
        try:
            centers[uri] = pt2llh(ap(Wm, [bb[0], bb[1], bb[2]]))
        except Exception:
            pass
    if uri and os.path.exists(os.path.join(TILES, uri)):
        key = None
        for hub in HUBS:
            if uri.startswith(hub + '-'):
                key = hub
                break
        if key in HUBS and '-z1-terrain' in uri:
            # 交付包自带「地形与边坡」层：派生时被 drop（pingluTiles.ts 成文），不参与渲染
            key = key + '/z1地形(丢弃)'
        if key is None and uri.startswith('corridor-'):
            key = 'corridor'
        if key is None and uri.startswith('bridges-'):
            key = 'bridges'
        if key:
            j, b = read_glb(os.path.join(TILES, uri))
            mats = j.get('materials') or [{}]
            M3 = np.array([[Wm[0], Wm[1], Wm[2]], [Wm[4], Wm[5], Wm[6]], [Wm[8], Wm[9], Wm[10]]])
            Tt = np.array(Wm[12:15])
            for mesh in j['meshes']:
                for pr in mesh['primitives']:
                    pos = acc(j, b, pr['attributes']['POSITION']).astype(np.float64)
                    P = np.empty_like(pos)
                    P[:, 0] = pos[:, 0]
                    P[:, 1] = -pos[:, 2]
                    P[:, 2] = pos[:, 1]
                    lo, la, h = ecef2llh(P @ M3 + Tt)
                    mi = pr.get('material')
                    name = mats[mi].get('name', '?') if mi is not None else '?'
                    data.setdefault(key, {}).setdefault(name, []).append(h)
                    per_uri.setdefault((key, uri), {}).setdefault(name, []).append(h)
                    if len(samples.setdefault(key, [])) < 4000:
                        st = max(1, len(h) // 512)
                        samples[key].extend(zip(lo[::st].tolist(), la[::st].tolist(), h[::st].tolist()))
    for c in node.get('children', []):
        walk(c, Wm)


walk(ts['root'], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

for c in ts['root']['children']:
    uri = (c.get('content') or {}).get('uri') or ''
    for hub in HUBS:
        if hub not in centers and uri.startswith(hub + '-'):
            b = c['boundingVolume']['box']
            M = mul(ts['root']['transform'], c['transform']) if c.get('transform') else ts['root']['transform']
            centers[hub] = pt2llh(ap(M, [b[0], b[1], b[2]]))

ds = rasterio.open(os.path.join(ROOT, 'backend/data/flood/dem/landsea_utm48n.tif'))


def to_dem_xy(lng, lat):
    e, n = wtransform('EPSG:4326', ds.crs, [lng], [lat])
    return e[0], n[0]

# EGM96 大地水准面差 N（= 椭球高 − 正高），PROJ `+proj=vgridshift +grids=us_nga_egm96_15.tif`
# （NGA 官方网格）实测：madao −21.70 / qishi −21.34 / qingnian −21.20 / port −20.50，跨度 1.2 m
N_EGM96 = {'madao': -21.70, 'qishi': -21.34, 'qingnian': -21.20, 'corridor': -21.4, 'bridges': -21.4}


def dem_at_pts(pts):
    """逐点取样 DEM（EGM96 正高）。返回 (pos 掩膜, 值数组)"""
    es, ns = wtransform('EPSG:4326', ds.crs, [p[0] for p in pts], [p[1] for p in pts])
    vals = np.array([v[0] for v in ds.sample(zip(es, ns))], dtype=np.float64)
    ok = np.isfinite(vals) & (np.abs(vals) < 1e5)
    if ds.nodata is not None:
        ok &= vals != ds.nodata
    return ok, vals


def n_of(k):
    return N_EGM96[k.split('/')[0]]


for hub in sorted(data):
    if hub in centers:
        lng, lat, hc = centers[hub]
    else:
        lng, lat = samples[hub][0][0], samples[hub][0][1]
        hc = float('nan')
    parts = []
    for name, hs in sorted(data[hub].items()):
        a = np.concatenate(hs)
        parts.append((name, len(a), float(np.percentile(a, 5)), float(np.median(a)), float(np.percentile(a, 95))))
    E, N = to_dem_xy(lng, lat)
    r, c = ds.index(E, N)
    win = ds.read(1, window=((max(0, r - 2), r + 3), (max(0, c - 2), c + 3))).astype(np.float64)
    dem = float(np.median(win[np.isfinite(win)])) if np.isfinite(win).any() else float('nan')
    print('\n%s 中心 %.6f,%.6f 椭球高 %.1f ｜ DEM(EGM96) %.1f m ｜ 素材（椭球高 P5/中位/P95，m）:' % (hub, lng, lat, hc, dem))
    for name, cnt, p5, p50, p95 in parts:
        print('   %-14s n=%-8d %+7.1f / %+7.1f / %+7.1f' % (name, cnt, p5, p50, p95))
    wat = np.concatenate(data[hub]['water']) if 'water' in data[hub] else np.array([])
    grp = [k for k in ('earth', 'grass', 'road', 'rock') if k in data[hub]]
    gr = np.concatenate([np.concatenate(data[hub][k]) for k in grp]) if grp else np.array([])

    def med(a):
        return float(np.median(a)) if len(a) else float('nan')

    print('   ⇒ 水面 %+.1f ｜ 地面组(%s) %+.1f ｜ 相对 DEM：水面 %+.1f / 地面 %+.1f ｜ 相对 0 m 平面：水面 %+.1f / 地面 %+.1f'
          % (med(wat), '+'.join(grp) or '-', med(gr), med(wat) - dem, med(gr) - dem, med(wat), med(gr)))
    pts = samples[hub]
    ok, vals = dem_at_pts(pts)
    hm = np.array([p[2] for p in pts])
    dlt = (hm[ok] - n_of(hub)) - vals[ok]
    print('   逐顶点 DEM 差（正高制，模型−DEM）：中位 %+.1f ｜ P10 %+.1f ｜ P90 %+.1f ｜ 有效 %d/%d'
          % (np.median(dlt), np.percentile(dlt, 10), np.percentile(dlt, 90), int(ok.sum()), len(pts)))

if True:
    print('\n走廊/桥梁逐瓦片（椭球高，m；V0 = 该瓦片几何首点，沿程用）:')
    want = ('corridor', 'bridges')
    if '--per-node' in sys.argv:
        want = want + ('madao', 'qishi', 'qingnian')
    for (key, uri) in sorted(per_uri):
        if key not in want:
            continue
        d = per_uri[(key, uri)]
        w = float(np.median(np.concatenate(d['water']))) if 'water' in d else float('nan')
        g = [k for k in ('grass', 'rock') if k in d]
        gr = float(np.median(np.concatenate([np.concatenate(d[k]) for k in g]))) if g else float('nan')
        cc = centers.get(uri)
        demt = float('nan')
        if cc:
            E2_, N2_ = to_dem_xy(cc[0], cc[1])
            rr, ccc = ds.index(E2_, N2_)
            w2 = ds.read(1, window=((max(0, rr - 2), rr + 3), (max(0, ccc - 2), ccc + 3))).astype(np.float64)
            if np.isfinite(w2).any():
                demt = float(np.median(w2[np.isfinite(w2)]))
        print('   %-16s 水 %+7.1f ｜ 岸 %+7.1f ｜ DEM@中心 %+7.1f ｜ %s,%s ｜ 材质 %s'
              % (uri, w, gr, demt, ('%.4f' % cc[0]) if cc else '-', ('%.4f' % cc[1]) if cc else '-', ','.join(sorted(d))))
        if '--water-stats' in sys.argv and key in ('madao', 'qishi', 'qingnian'):
            for mat in ('water', 'poolWater'):
                if mat in d and len(np.concatenate(d[mat])):
                    a = np.concatenate(d[mat])
                    q = np.percentile(a, [5, 10, 25, 50, 75, 90, 95])
                    print('        %-10s n=%-6d P5/10/25/50/75/90/95: %s'
                          % (mat, len(a), ' '.join('%+.1f' % v for v in q)))
        allh = np.concatenate([np.concatenate(v) for v in d.values()])
        wh = np.concatenate(d['water']) if 'water' in d else np.array([])
        print('        世界椭球高：全体 %+.1f..%+.1f ｜ 水 %+.1f..%+.1f ｜ 全高中位 %+.1f'
              % (allh.min(), allh.max(), (wh.min() if len(wh) else float('nan')),
                 (wh.max() if len(wh) else float('nan')), np.median(allh)))

# ---- 可选：与运行时 Cesium 的 model.boundingSphere 对照（--sphere <uri>）----
if '--sphere' in sys.argv:
    target = sys.argv[sys.argv.index('--sphere') + 1]
    pts = []

    def collect(node, M):
        Wm = mul(M, node['transform']) if node.get('transform') else M
        uri = (node.get('content') or {}).get('uri') or ''
        if uri == target and os.path.exists(os.path.join(TILES, uri)):
            j, b = read_glb(os.path.join(TILES, uri))
            M3 = np.array([[Wm[0], Wm[1], Wm[2]], [Wm[4], Wm[5], Wm[6]], [Wm[8], Wm[9], Wm[10]]])
            Tt = np.array(Wm[12:15])
            for mesh in j['meshes']:
                for pr in mesh['primitives']:
                    pos = acc(j, b, pr['attributes']['POSITION']).astype(np.float64)
                    P = np.empty_like(pos)
                    P[:, 0] = pos[:, 0]
                    P[:, 1] = -pos[:, 2]
                    P[:, 2] = pos[:, 1]
                    pts.append(P @ M3 + Tt)
        for c in node.get('children', []):
            collect(c, Wm)

    collect(ts['root'], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    Q = np.vstack(pts)
    lo, hi = Q.min(0), Q.max(0)
    ctr = (lo + hi) / 2
    rad = float(np.sqrt(((Q - ctr) ** 2).sum(1).max()))
    lo2, la2, h2 = pt2llh(ctr)
    print('\n[sphere] %s：顶点 %d ｜ AABB 中心 %.6f,%.6f 椭球高 %.1f ｜ 半径(最大距) %.1f ｜ 竖直 %.1f..%.1f'
          % (target, len(Q), lo2, la2, h2, rad,
             ecef2llh(Q)[2].min(), ecef2llh(Q)[2].max()))
    # glTF 空间（未做 Y-up→Z-up）的 AABB 中心：供浏览器用 Cesium 自己的 modelMatrix 变换对照
    jj, bb = read_glb(os.path.join(TILES, target))
    mn = [1e18] * 3
    mx = [-1e18] * 3
    for mesh in jj['meshes']:
        for pr in mesh['primitives']:
            a = jj['accessors'][pr['attributes']['POSITION']]
            for k in range(3):
                mn[k] = min(mn[k], a['min'][k])
                mx[k] = max(mx[k], a['max'][k])
    print('[gltf] %s：glTF 空间 AABB 中心 %.3f,%.3f,%.3f ｜ min %s ｜ max %s'
          % (target, (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2, mn, mx))
    # 与浏览器对账用：该 uri 所在节点的复合矩阵（列主序，含 root），打印为一行
    mats = []

    def collectM(node, M):
        Wm = mul(M, node['transform']) if node.get('transform') else M
        uri = (node.get('content') or {}).get('uri') or ''
        if uri == target:
            mats.append(Wm)
        for c in node.get('children', []):
            collectM(c, Wm)

    collectM(ts['root'], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    if mats:
        print('[chain] %s：%s' % (target, ','.join('%.6f' % v for v in mats[0])))
        m = mats[0]
        gx, gy, gz = (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2
        # 我方 Y-up→Z-up：glTF (x,y,z) → ENU (x, −z, y)，再乘复合矩阵
        w = ap(m, [gx, -gz, gy])
        wl, wa, wh = pt2llh(w)
        print('[xform] %s：glTF 盒中心 → 世界 %.7f,%.7f 椭球高 %.1f（浏览器同点应为同一行）'
              % (target, wl, wa, wh))

# ---- 我方重建运河带（真正渲染的那条：beibu-pinglu-canal 层 → canal.glb）同口径 ----
CT = os.path.join(ROOT, 'backend/static/pinglu/canal')
cts = json.load(open(os.path.join(CT, 'tileset.json'), encoding='utf-8'))
cdata = {}
csamp = []
cwater = []


def cwalk(node, M):
    Wm = mul(M, node['transform']) if node.get('transform') else M
    uri = (node.get('content') or {}).get('uri') or ''
    if uri and os.path.exists(os.path.join(CT, uri)):
        j, b = read_glb(os.path.join(CT, uri))
        mats = j.get('materials') or [{}]
        M3 = np.array([[Wm[0], Wm[1], Wm[2]], [Wm[4], Wm[5], Wm[6]], [Wm[8], Wm[9], Wm[10]]])
        Tt = np.array(Wm[12:15])
        for mesh in j['meshes']:
            for pr in mesh['primitives']:
                pos = acc(j, b, pr['attributes']['POSITION']).astype(np.float64)
                P = np.empty_like(pos)
                P[:, 0] = pos[:, 0]
                P[:, 1] = -pos[:, 2]
                P[:, 2] = pos[:, 1]
                lo, la, h = ecef2llh(P @ M3 + Tt)
                mi = pr.get('material')
                name = mats[mi].get('name', '?') if mi is not None else '?'
                cdata.setdefault(name, []).append(h)
                if name == 'canal-water':
                    cwater.extend(zip(lo.tolist(), la.tolist(), h.tolist()))
                if len(csamp) < 4000:
                    st = max(1, len(h) // 512)
                    csamp.extend(zip(lo[::st].tolist(), la[::st].tolist(), h[::st].tolist()))
    for c in node.get('children', []):
        cwalk(c, Wm)


cwalk(cts['root'], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
print('\ncanal（我方重建带 = beibu-pinglu-canal 层）素材（椭球高 P5/中位/P95，m）:')
for name, hs in sorted(cdata.items()):
    a = np.concatenate(hs)
    print('   %-14s n=%-8d %+7.1f / %+7.1f / %+7.1f'
          % (name, len(a), float(np.percentile(a, 5)), float(np.median(a)), float(np.percentile(a, 95))))
if csamp:
    ok, vals = dem_at_pts(csamp)
    hm = np.array([p[2] for p in csamp])
    dlt = (hm[ok] - (-21.4)) - vals[ok]
    print('   逐顶点 DEM 差（正高制，模型−DEM）：中位 %+.1f ｜ P10 %+.1f ｜ P90 %+.1f ｜ 有效 %d/%d'
          % (np.median(dlt), np.percentile(dlt, 10), np.percentile(dlt, 90), int(ok.sum()), len(csamp)))
    print('   带内水面 vs 枢纽模型（半径 800 m 取样，椭球高 m）：')
    for hub in HUBS:
        if hub not in centers:
            continue
        hlng, hlat, _ = centers[hub]
        near = [h for (lo_, la_, h) in cwater
                if abs(lo_ - hlng) < 0.008 and abs(la_ - hlat) < 0.008]
        bandw = float(np.median(near)) if near else float('nan')
        hubw = float(np.median(np.concatenate(data[hub]['water']))) if 'water' in data[hub] else float('nan')
        hubg = [k for k in ('earth', 'grass', 'road', 'rock') if k in data[hub]]
        hubgr = float(np.median(np.concatenate([np.concatenate(data[hub][k]) for k in hubg]))) if hubg else float('nan')
        print('      %-9s 带水 %+7.1f（n=%d） ｜ 枢纽水 %+7.1f ｜ 枢纽地面组 %+7.1f ｜ 带水−枢纽水 %+.1f'
              % (hub, bandw, len(near), hubw, hubgr, bandw - hubw))

# ---- 钦州港作业区（交付包）同口径 ----
PTILES = os.path.join(ROOT, 'backend/static/qinzhou-port/tiles')
pts_ = json.load(open(os.path.join(PTILES, 'tileset.json'), encoding='utf-8'))
prl, pra, prh = pt2llh(pts_['root']['transform'][12:15])
print('\nport root 原点：%.6f,%.6f 椭球高 %.1f m' % (prl, pra, prh))
pdata = {}
psamp = {}


def pwalk(node, M):
    Wm = mul(M, node['transform']) if node.get('transform') else M
    uri = (node.get('content') or {}).get('uri') or ''
    if uri and os.path.exists(os.path.join(PTILES, uri)):
        j, b = read_glb(os.path.join(PTILES, uri))
        mats = j.get('materials') or [{}]
        M3 = np.array([[Wm[0], Wm[1], Wm[2]], [Wm[4], Wm[5], Wm[6]], [Wm[8], Wm[9], Wm[10]]])
        Tt = np.array(Wm[12:15])
        for mesh in j['meshes']:
            for pr in mesh['primitives']:
                mi = pr.get('material')
                name = mats[mi].get('name', '?') if mi is not None else '?'
                if name not in ('rail', 'concrete', 'opaque', 'metal', 'water', 'cargo'):
                    continue
                pos = acc(j, b, pr['attributes']['POSITION']).astype(np.float64)
                P = np.empty_like(pos)
                P[:, 0] = pos[:, 0]
                P[:, 1] = -pos[:, 2]
                P[:, 2] = pos[:, 1]
                lo, la, hh = ecef2llh(P @ M3 + Tt)
                pdata.setdefault(name, []).append(hh)
                if len(psamp.setdefault(name, [])) < 1500:
                    st = max(1, len(hh) // 256)
                    psamp[name].extend(zip(lo[::st].tolist(), la[::st].tolist(), hh[::st].tolist()))
    for c in node.get('children', []):
        pwalk(c, Wm)


pwalk(pts_['root'], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
_bs = [
    t['bbox']
    for t in json.load(open(os.path.join(ROOT, 'backend/static/qinzhou-port/imagery/imagery.json'), encoding='utf-8'))['tiles']
]
plng = (min(b[0] for b in _bs) + max(b[2] for b in _bs)) / 2
plat = (min(b[1] for b in _bs) + max(b[3] for b in _bs)) / 2
E, N = to_dem_xy(plng, plat)
r, c = ds.index(E, N)
win = ds.read(1, window=((max(0, r - 2), r + 3), (max(0, c - 2), c + 3))).astype(np.float64)
pdem = float(np.median(win[np.isfinite(win)])) if np.isfinite(win).any() else float('nan')
print('port DEM(EGM96) @ %.5f,%.5f = %s' % (plng, plat, ('%.1f' % pdem) if np.isfinite(pdem) else 'NaN(海/无值)'))
for name, hs in sorted(pdata.items()):
    a = np.concatenate(hs)
    print('   %-10s n=%-8d %+7.1f / %+7.1f / %+7.1f' % (name, len(a), float(np.percentile(a, 5)), float(np.median(a)), float(np.percentile(a, 95))))
    pts = psamp.get(name) or []
    if pts:
        ok, vals = dem_at_pts(pts)
        hm = np.array([p[2] for p in pts])
        dlt = (hm[ok] - (-20.50)) - vals[ok]
        print('              逐顶点 DEM 差（模型正高−DEM）：中位 %+.1f ｜ P10 %+.1f ｜ P90 %+.1f ｜ 有效 %d/%d'
              % (np.median(dlt), np.percentile(dlt, 10), np.percentile(dlt, 90), int(ok.sum()), len(pts)))
