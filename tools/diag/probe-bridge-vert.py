# -*- coding: utf-8 -*-
"""probe-bridge-vert.py — 城区五桥绝对垂直位置探针（只读；N3 收口单第 1 项判据）。

读 bridges-city/tileset.json 全链变换 + 各桥 GLB 顶点 → 世界椭球高，按 COLOR_0 分桶
（桥面/桥墩/栏杆/塔）；与同点统一 DEM（椭球高）对比。

判据（净高语义：通航净高 = 设计水位 → 桥面结构**底缘**）：
  ① 桥面底 − 水面 = clearance（子材 19.3 m）× 各桥 ±0.5 m；
  ② 桥墩底 ≤ 水面（墩入水/入地，不得悬空）；
  ③ 锚点自检：root 原点椭球高 = 0.00 ± 0.5 m（锚点按 h=0 建）。

--emit-anchors <path>：按各 child 的 extras.name + 顶点经纬中位点采样 DEM，写构建输入锚点表。

用法（venv，需 numpy/rasterio）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 tools/diag/probe-bridge-vert.py
  … tools/diag/probe-bridge-vert.py --emit-anchors tools/3dtiles-build/bridge-anchors.json
"""
import argparse, ast, hashlib, json, os, sys
import numpy as np
import rasterio
from rasterio.warp import transform as rtransform

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DEFAULT_TILES = os.path.join(ROOT, 'backend/static/bridges-city')
DEFAULT_DEM = os.path.join(ROOT, 'backend/data/flood/dem/landsea_utm48n_ell.tif')

PALETTE_SOURCE = os.path.join(ROOT, 'tools', 'lib', 'bridge-palette.mjs')

def load_bridge_palette(path=PALETTE_SOURCE):
    """取权威源里的 BRIDGE_PALETTE 对象字面量（与 build-bridges.mjs 同一份）。

    两侧各抄一份时色值漂移**不报错**，只让分桶为空、判据恒红，故本探针不内联色值。
    用 ast 解析而非正则：换引号 / 换缩进 / 重排行都不至于静默取空（P3·D23 余项）。
    """
    text = open(path, encoding='utf-8').read()
    i = text.index('export const BRIDGE_PALETTE =')
    i = text.index('{', i)
    depth = 0
    end = None
    for j in range(i, len(text)):
        if text[j] == '{':
            depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                end = j
                break
    if end is None:
        raise ValueError('权威源里没有闭合的 BRIDGE_PALETTE 对象字面量：%s' % path)
    node = ast.parse(text[i:end + 1], mode='eval').body
    return {key.id: [elt.value for elt in val.elts] for key, val in zip(node.keys, node.values)}

# 构件色分桶表（P3·D23 余项：权威源 tools/lib/bridge-palette.mjs，三处一律从它派生）
PALETTE = load_bridge_palette()
BUCKETS = {k: tuple(v) for k, v in PALETTE.items()}

def mul(x, y):
    o = [0.0] * 16
    for i in range(4):
        for j in range(4):
            o[i * 4 + j] = sum(x[k * 4 + j] * y[i * 4 + k] for k in range(4))
    return o

sys.path.insert(0, os.path.join(ROOT, 'tools', 'lib'))
from geo import ecef_to_geo  # noqa: E402
from glb import accessor, read_glb  # noqa: E402

def ecef2ll(E):
    return ecef_to_geo(E)  # 实现唯一位于 tools/lib/geo.py（P4 收口）

def sample(ds, lng, lat):
    xs, ys = rtransform('EPSG:4326', ds.crs, [lng], [lat])
    v = float(next(ds.sample(zip(xs, ys)))[0])
    if v == ds.nodata:
        raise SystemExit('DEM 在 %.6f,%.6f 处为 nodata（%.6f,%.6f 为 nodata 值）' % (lng, lat, v, ds.nodata))
    return v

def walk_vertices(tiles_dir, ts):
    """产出 [(name, lng[], lat[], h[], u_local[], colors[])]，逐 child。"""
    out = []
    W0 = ts['root']['transform']
    for c in ts['root']['children']:
        uri = (c.get('content') or {}).get('uri')
        if not uri:
            continue
        name = (c.get('extras') or {}).get('name') or uri.replace('.glb', '')
        W = mul(W0, c['transform']) if c.get('transform') else W0
        j, b = read_glb(os.path.join(tiles_dir, uri))
        M3 = np.array([[W[0], W[1], W[2]], [W[4], W[5], W[6]], [W[8], W[9], W[10]]])
        Tt = np.array([W[12], W[13], W[14]])
        pos = accessor(j, b, j['meshes'][0]['primitives'][0]['attributes']['POSITION']).astype(np.float64)
        col = accessor(j, b, j['meshes'][0]['primitives'][0]['attributes']['COLOR_0']).astype(np.float64)
        P = np.empty_like(pos)
        P[:, 0] = pos[:, 0]
        P[:, 1] = -pos[:, 2]
        P[:, 2] = pos[:, 1]
        lng, lat, h = ecef2ll(P @ M3 + Tt)
        out.append((name, lng, lat, h, P[:, 2].copy(), col))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles', default=DEFAULT_TILES)
    ap.add_argument('--dem', default=DEFAULT_DEM)
    ap.add_argument('--emit-anchors', default=None)
    a = ap.parse_args()
    ts = json.load(open(os.path.join(a.tiles, 'tileset.json'), encoding='utf-8'))
    ds = rasterio.open(a.dem)

    # ③ 锚点自检（先跑）：root 原点是 h=0 建锚
    O = np.array([[ts['root']['transform'][12], ts['root']['transform'][13], ts['root']['transform'][14]]])
    _, _, oh = ecef2ll(O)
    ok0 = abs(float(oh[0])) <= 0.5
    print('自检：root 原点椭球高 %+.2f m（期望 0.00±0.5）%s' % (oh[0], '✓' if ok0 else '✗'))

    verts = walk_vertices(a.tiles, ts)

    if a.emit_anchors:
        dem_md5 = hashlib.md5(open(a.dem, 'rb').read()).hexdigest()
        bridges = {}
        for name, lng, lat, h, u, col in verts:
            clon, clat = float(np.median(lng)), float(np.median(lat))
            bridges[name] = {
                'surface_ell_m': sample(ds, clon, clat),
                'clearance_m': 19.3,
                'sample_lonlat': [round(clon, 6), round(clat, 6)],
            }
        doc = {
            'note': '桥垂直锚点（净高语义：桥面结构底缘 = 水面 + clearance_m）。surface_ell_m = '
                    '统一 DEM（椭球高）在各桥中点取值；生成：tools/diag/probe-bridge-vert.py --emit-anchors。',
            'dem': '%s md5 %s' % (os.path.relpath(a.dem, ROOT).replace(os.sep, '/'), dem_md5),
            'clearance_note': '子材大桥净高 19.3 m（公开资料）；其余四座无公开净高，暂同口径（假设，有资料即改）。',
            'bridges': bridges,
        }
        json.dump(doc, open(a.emit_anchors, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print('WROTE %s（%d 桥）' % (a.emit_anchors, len(bridges)))
        for k, v in bridges.items():
            print('  %-6s 水面椭球 %+7.1f m（采样 %.5f,%.5f）' % (k, v['surface_ell_m'], *v['sample_lonlat']))
        return 0

    # 实测 + 判据
    ok = ok0
    print('%-10s | %-9s | %-9s | %-9s | %-8s | %-9s | 净高(底)' % ('桥', '桥面底', '桥面顶', '墩底', '栏杆顶', '水面(椭球)'))
    for name, lng, lat, h, u, col in verts:
        clon, clat = float(np.median(lng)), float(np.median(lat))
        surf = sample(ds, clon, clat)
        b = {}
        for k, c in BUCKETS.items():
            m = (np.abs(col - np.array(c)).max(axis=1) < 1e-3)
            b[k] = h[m] if m.any() else np.array([np.nan])
        deck_lo, deck_hi = float(np.min(b['deck'])), float(np.max(b['deck']))
        pier_lo = float(np.min(b['pier']))
        rail_hi = float(np.nanmax(b['rail']))
        gap = deck_lo - surf
        c1 = abs(gap - 19.3) <= 0.5
        c2 = pier_lo <= surf
        ok = ok and c1 and c2
        print('%-10s | %+9.1f | %+9.1f | %+9.1f | %+8.1f | %+9.1f | %+6.1f %s 墩−水面 %+.1f %s'
              % (name, deck_lo, deck_hi, pier_lo, rail_hi, surf, gap, '✓' if c1 else '✗',
                 pier_lo - surf, '✓' if c2 else '✗'))
    print('判据：桥面底−水面 = 19.3±0.5 ｜ 墩底 ≤ 水面 ｜ 锚点自检 ｜ ⇒ %s' % ('全部通过' if ok else '不通过'))
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
