# -*- coding: utf-8 -*-
"""port-overlay.py — 钦州港作业区对位叠加图（只读）。
底图=交付包自带的天地图影像（port.jpg 2048²）；蓝=交付包 water 海面；
白线=模型东侧水缘（右缘水像素）；青线=影像水面分类掩膜的东侧水缘；青点=影像水面边界；格=20 m。
用法（venv，需 numpy/Pillow）：
  backend/algorithm-service/.venv/Scripts/python.exe tools/diag/port-overlay.py
输出：.local/3d-review/port-overlay.png（不入库，只作决定图）
"""
import json, os, math, struct, base64
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
N = 2048
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


def ecef2ll(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    lng = np.degrees(np.arctan2(y, x))
    p2 = np.hypot(x, y)
    lat = np.arctan2(z, p2 * (1 - E2))
    for _ in range(8):
        Nn = A_ / np.sqrt(1 - E2 * np.sin(lat) ** 2)
        h = p2 / np.cos(lat) - Nn
        lat = np.arctan2(z, p2 * (1 - E2 * Nn / (Nn + h)))
    return lng, np.degrees(lat)


idx = json.load(open(os.path.join(ROOT, 'backend/static/qinzhou-port/imagery/imagery.json'), encoding='utf-8'))
ent = idx['tiles'][0]
w, s, e, n = ent['bbox']
mperpx = (e - w) * 111320 * math.cos(math.radians((s + n) / 2)) / N

TILES = os.path.join(ROOT, 'backend/static/qinzhou-port/tiles')
ts = json.load(open(os.path.join(TILES, 'tileset.json'), encoding='utf-8'))
tris = []


def walk(node, Mx):
    Wm = mul(Mx, node['transform']) if node.get('transform') else Mx
    uri = (node.get('content') or {}).get('uri') or ''
    if uri and os.path.exists(os.path.join(TILES, uri)):
        j, b = read_glb(os.path.join(TILES, uri))
        mats = j.get('materials') or [{}]
        M3 = np.array([[Wm[0], Wm[1], Wm[2]], [Wm[4], Wm[5], Wm[6]], [Wm[8], Wm[9], Wm[10]]])
        Tt = np.array([Wm[12], Wm[13], Wm[14]])
        for mesh in j['meshes']:
            for pr in mesh['primitives']:
                mi = pr.get('material')
                if mi is None or mats[mi].get('name', '') != 'water':
                    continue
                pos = acc(j, b, pr['attributes']['POSITION']).astype(np.float64)
                P = np.empty_like(pos)
                P[:, 0] = pos[:, 0]
                P[:, 1] = -pos[:, 2]
                P[:, 2] = pos[:, 1]
                lng, lat = ecef2ll(P @ M3 + Tt)
                X = (lng - w) / (e - w) * N
                Y = (n - lat) / (n - s) * N
                if 'indices' in pr:
                    ind = acc(j, b, pr['indices']).reshape(-1).astype(np.int64)
                else:
                    ind = np.arange(len(pos), dtype=np.int64)
                ind = ind[:(len(ind) // 3) * 3].reshape(-1, 3)
                xs, ys = X[ind], Y[ind]
                keep = ((xs > -200) & (xs < N + 200)).any(axis=1) & ((ys > -200) & (ys < N + 200)).any(axis=1)
                for t in ind[keep]:
                    tris.append((X[t].copy(), Y[t].copy()))
    for c in node.get('children', []):
        walk(c, Wm)


walk(ts['root'], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

img = Image.open(os.path.join(ROOT, 'backend/static/qinzhou-port/imagery/port.jpg')).convert('RGB')
if img.size != (N, N):
    img = img.resize((N, N), Image.LANCZOS)
img = img.convert('RGBA')
layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))
dl = ImageDraw.Draw(layer)
for tx, ty in tris:
    dl.polygon(list(zip(tx.tolist(), ty.tolist())), fill=(40, 120, 255, 80))
img = Image.alpha_composite(img, layer)
d = ImageDraw.Draw(img, 'RGBA')

A = np.zeros((N, N), dtype=bool)
m2 = Image.new('L', (N, N), 0)
dm = ImageDraw.Draw(m2)
for tx, ty in tris:
    dm.polygon(list(zip(tx.tolist(), ty.tolist())), fill=255)
A |= np.asarray(m2) > 0

wm = json.load(open(os.path.join(ROOT, 'backend/static/qinzhou-port/imagery/water-mask.json'), encoding='utf-8'))
M = wm['size']
bits = np.unpackbits(np.frombuffer(base64.b64decode(wm['bits']), dtype=np.uint8))[:M * M]
B0 = bits.reshape(M, M) > 0


def boundary(mask):
    b = np.zeros_like(mask)
    b[1:, :] |= mask[1:, :] & ~mask[:-1, :]
    b[:-1, :] |= mask[:-1, :] & ~mask[1:, :]
    b[:, 1:] |= mask[:, 1:] & ~mask[:, :-1]
    b[:, :-1] |= mask[:, :-1] & ~mask[:, 1:]
    return b


Bb = boundary(B0)
ys, xs = np.nonzero(Bb)
sc = N / M
for x, y in zip(xs.tolist(), ys.tolist()):
    px_, py_ = x * sc, y * sc
    d.point([(px_, py_), (px_ + 1, py_), (px_, py_ + 1), (px_ + 1, py_ + 1)], fill=(0, 255, 255, 150))


def shore(mask):
    pts = []
    for y in range(N):
        xs_ = np.nonzero(mask[y])[0]
        if len(xs_) and xs_.max() < N - 2:
            pts.append((float(xs_.max()), float(y)))
    return pts


mpts = shore(A)
Bup = np.asarray(Image.fromarray((B0 * 255).astype(np.uint8)).resize((N, N), Image.NEAREST)) > 127
ipts = shore(Bup)
if len(mpts) > 1:
    d.line(mpts, fill=(255, 255, 255, 255), width=3)
if len(ipts) > 1:
    d.line(ipts, fill=(0, 255, 255, 255), width=3)

step = max(1, int(round(20 / mperpx)))
for x in range(0, N, step):
    d.line([(x, 0), (x, N)], fill=(255, 255, 255, 40))
for y in range(0, N, step):
    d.line([(0, y), (N, y)], fill=(255, 255, 255, 40))

legend = [
    'QINZHOU PORT  base: shipped Tianditu 2026-09-20 (2048px)',
    'BLUE fill   = delivery-package water (all LODs)',
    'WHITE line  = model east water edge (shore)',
    'CYAN line   = imagery-classified east water edge',
    'cyan dots   = imagery-classified water boundary',
    'grid = 20 m',
]
for i, sline in enumerate(legend):
    d.text((10, 10 + i * 16), sline, fill=(255, 255, 0, 255))
o = os.path.join(ROOT, '.local/3d-review', 'port-overlay.png')
img.convert('RGB').save(o)
print('WROTE %s %s m/px=%.3f 模型水缘点 %d ｜ 影像水缘点 %d ｜ 水缘点共 %d'
      % (o, img.size, mperpx, len(mpts), len(ipts), len(xs)))

md = {int(y): x for x, y in mpts}
idm = {int(y): x for x, y in ipts}
common = sorted(set(md) & set(idm))
if common:
    dv = np.array([(md[y] - idm[y]) * mperpx for y in common])
    print('同排水缘差：中位 %+.1f m（MAD %.1f m，%d 行）'
          % (float(np.median(dv)), float(np.median(np.abs(dv - np.median(dv)))), len(dv)))
