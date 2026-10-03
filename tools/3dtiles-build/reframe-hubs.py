# -*- coding: utf-8 -*-
"""reframe-hubs.py — 把三枢纽的**朝向**拧到运河走向上（保持几何中心不动）。

依据：交付包《模型建模说明.md》规定局部系 +X=下游、+Y=高程、+Z=右岸；glTF Y-up 下
      tile 局部 X=下游、Y=-右岸、Z=上。child.transform 的坐标系**就是 root 的 ENU 系**
      （3D Tiles：child 变换相对父节点），故第 1 列 (c0,c1,c2) 即下游方向在 ENU 里的像，
      方位角 = atan2(c0, c1)。

参照：运河带水面中心线在枢纽附近 ±1200 m 内的走向。**必须在经纬度上算方位角**——
      先前拿 ECEF 坐标当 ENU 用，算出的不是方位角（已作废）。

实测（2026-10-03，.local/3d-review/band-dir.py）：马道 +35.8°、企石 -6.5°、青年 +11.2°。
用法：python tools/3dtiles-build/reframe-hubs.py [--apply]
"""
import json, os, struct, math, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TILES = os.path.join(ROOT, 'backend/static/pinglu/tiles/tileset.json')
CANAL = os.path.join(ROOT, 'backend/static/pinglu/canal')
A_, F = 6378137.0, 1 / 298.257223563
E2 = F * (2 - F)
APPLY = '--apply' in sys.argv

def read_glb(p):
    b = open(p, 'rb').read(); off, js, bin_ = 12, None, None
    while off + 8 <= len(b):
        ln, ty = struct.unpack_from('<II', b, off)
        d = b[off + 8:off + 8 + ln]
        if ty == 0x4E4F534A: js = json.loads(d)
        elif ty == 0x004E4942: bin_ = d
        off += 8 + ln + ((4 - ln % 4) % 4)
    return js, bin_
CS = {5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
NC = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def acc(j, b, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    fmt, sz = CS[a['componentType']]; nc = NC[a['type']]
    st = bv.get('byteStride') or sz * nc; base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return [struct.unpack_from('<' + fmt * nc, b, base + k * st) for k in range(a['count'])]
def ap(m, p):
    return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]]
def to_lnglat(p):
    x, y, z = p; lng = math.degrees(math.atan2(y, x)); p2 = math.hypot(x, y); lat = math.atan2(z, p2*(1-E2))
    for _ in range(8):
        N = A_/math.sqrt(1-E2*math.sin(lat)**2); h = p2/math.cos(lat)-N
        lat = math.atan2(z, p2*(1-E2*N/(N+h)))
    return lng, math.degrees(lat)

ts = json.load(open(TILES, encoding='utf-8'))
ct = json.load(open(os.path.join(CANAL, 'tileset.json'), encoding='utf-8'))
cj, cb = read_glb(os.path.join(CANAL, ct['root']['content']['uri'].split('/')[-1]))
Tc = ct['root']['transform']
band = []
for m in cj['meshes']:
    for pr in m['primitives']:
        if 'water' not in (cj.get('materials') or [{}])[pr.get('material', 0)].get('name', ''): continue
        for p in acc(cj, cb, pr['attributes']['POSITION']):
            lng, lat = to_lnglat(ap(Tc, [p[0], -p[2], p[1]]))
            band.append((lng, lat))
band = np.array(band)

changed = []
for hub in ('madao', 'qishi', 'qingnian'):
    child = next(c for c in ts['root']['children'] if ((c.get('content') or {}).get('uri') or '').startswith(hub + '-'))
    cT = child['transform']
    b = child['boundingVolume']['box']
    c_local = [b[0], b[1], b[2]]
    # 中心在 root 的 ENU 系里（child 变换即 ENU 系内的变换）——**不复合 root.transform**
    C = ap(cT, c_local)
    hl = to_lnglat(ap(ts['root']['transform'], ap(cT, c_local)))
    dd = np.hypot((band[:,0]-hl[0])*111320*math.cos(math.radians(hl[1])), (band[:,1]-hl[1])*110574)
    near = band[dd < 1200]
    if len(near) < 50:
        print('%s: 带样本不足' % hub); continue
    order = np.argsort(near[:,1])
    q = max(5, len(order)//12)
    s0 = near[order[:q]].mean(axis=0)   # 南端（下游）
    s1 = near[order[-q:]].mean(axis=0)  # 北端（上游）
    dE = (s0[0]-s1[0])*111320*math.cos(math.radians(hl[1])); dN = (s0[1]-s1[1])*110574
    bearing = (math.degrees(math.atan2(dE, dN)) + 360) % 360
    old = (math.degrees(math.atan2(cT[0], cT[1])) + 360) % 360
    r = math.radians(bearing)
    col1 = (math.sin(r), math.cos(r), 0.0)
    col2 = (-math.cos(r), math.sin(r), 0.0)
    col3 = (0.0, 0.0, 1.0)
    R = [col1[0], col1[1], col1[2], 0.0, col2[0], col2[1], col2[2], 0.0, col3[0], col3[1], col3[2], 0.0]
    Rc = ap(R + [0, 0, 0, 1], c_local)
    t = [C[0]-Rc[0], C[1]-Rc[1], C[2]-Rc[2]]
    d = ((bearing - old + 540) % 360) - 180
    print('%s | 旧 %6.1f° -> 新 %6.1f°（拧 %+6.1f°）| ENU 中心 [%.1f, %.1f, %.1f] 不变'
          % (hub, old, bearing, d, C[0], C[1], C[2]))
    if APPLY:
        child['transform'] = R + [t[0], t[1], t[2], 1.0]
        changed.append(hub)
if APPLY and changed:
    raw = open(TILES, encoding='utf-8').read()
    nxt = raw.split('\n')[1]
    ind = (len(nxt) - len(nxt.lstrip(' '))) or 2
    json.dump(ts, open(TILES, 'w', encoding='utf-8'), ensure_ascii=False, indent=ind)
    open(TILES, 'a', encoding='utf-8').write('\n')
    print('已写入 %s（%s），缩进=%d' % (TILES, ','.join(changed), ind))
elif not APPLY:
    print('（未给 --apply，未落盘）')