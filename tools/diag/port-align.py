# -*- coding: utf-8 -*-
"""port-align.py — 钦州港交付包"海面" vs 影像水面掩膜的独立对位测量（只读）。

两把尺互不耦合：
  模型边界 = 交付包 water 材质三角面（含全部层级）投到影像 bbox 栅格；
  影像边界 = make-water-mask.py 的固定取样掩膜 water-mask.json（1024²，非模型耦合）。
输出：FFT 互相关峰（平移）+ 转角扫描 + 逐行水缘差交叉校验；含合成位移自检。
用法（venv，需 numpy/Pillow）：
  backend/algorithm-service/.venv/Scripts/python.exe tools/diag/port-align.py
前置：交付包 tiles/ 与 imagery/{imagery.json,water-mask.json} 在盘（.gitignore 排除）。
"""
import json, os, sys, math, struct, base64
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
N = 1024
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


def px(lng, lat):
    return ((lng - w) / (e - w) * N, (n - lat) / (n - s) * N)


wm = json.load(open(os.path.join(ROOT, 'backend/static/qinzhou-port/imagery/water-mask.json'), encoding='utf-8'))
assert abs(wm['bbox'][0] - w) < 1e-9 and abs(wm['bbox'][3] - n) < 1e-9, 'water-mask bbox ≠ imagery bbox'
M = wm['size']
bits = np.unpackbits(np.frombuffer(base64.b64decode(wm['bits']), dtype=np.uint8))[:M * M]
B = (bits.reshape(M, M) > 0)
if M != N:
    B = np.asarray(Image.fromarray((B * 255).astype(np.uint8)).resize((N, N), Image.NEAREST)) > 127

TILES = os.path.join(ROOT, 'backend/static/qinzhou-port/tiles')
ts = json.load(open(os.path.join(TILES, 'tileset.json'), encoding='utf-8'))
tris = []
missing = [0]
nodes = [0]


def walk(node, Mx):
    Wm = mul(Mx, node['transform']) if node.get('transform') else Mx
    uri = (node.get('content') or {}).get('uri') or ''
    if uri:
        p = os.path.join(TILES, uri)
        if not os.path.exists(p):
            missing[0] += 1
        else:
            nodes[0] += 1
            j, b = read_glb(p)
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
                    E = P @ M3 + Tt
                    lng, lat = ecef2ll(E)
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
mi = Image.new('L', (N, N), 0)
d = ImageDraw.Draw(mi)
for tx, ty in tris:
    d.polygon(list(zip(tx.tolist(), ty.tolist())), fill=255)
A = np.asarray(mi) > 0
print('模型 water 三角 %d ｜ 载入瓦片 %d ｜ 缺文件 %d ｜ 模型水面 %d px / 影像水面 %d px ｜ %.2f m/px'
      % (len(tris), nodes[0], missing[0], int(A.sum()), int(B.sum()), mperpx))
print('影像水面左右半占比 %.2f / %.2f' % (B[:, :N // 2].mean(), B[:, N // 2:].mean()))


def boundary(m):
    b = np.zeros_like(m)
    b[1:, :] |= m[1:, :] & ~m[:-1, :]
    b[:-1, :] |= m[:-1, :] & ~m[1:, :]
    b[:, 1:] |= m[:, 1:] & ~m[:, :-1]
    b[:, :-1] |= m[:, :-1] & ~m[:, 1:]
    return b


def peak(Ae, Be, rad=120):
    S = 2 * N
    Fa = np.fft.rfft2(Ae.astype(np.float32), s=(S, S))
    Fb = np.fft.rfft2(Be.astype(np.float32), s=(S, S))
    C = np.fft.irfft2(Fa * np.conj(Fb), s=(S, S))
    rows = list(range(0, rad + 1)) + list(range(S - rad, S))
    cols = list(range(0, rad + 1)) + list(range(S - rad, S))
    W = C[np.ix_(rows, cols)]
    k = int(np.argmax(W))
    ri, ci = divmod(k, W.shape[1])
    dy = rows[ri] - (S if rows[ri] >= S - rad else 0)
    dx = cols[ci] - (S if cols[ci] >= S - rad else 0)
    return dx, dy, float(W[ri, ci])


# 合成自检：把影像掩膜整体平移 (+23,+17) px，互相关峰应回收同量级
Bs = np.roll(B, (17, 23), axis=(0, 1))
cdx, cdy, _ = peak(boundary(A if False else Bs), boundary(B))
print('自检（把影像掩膜平移 +23,+17 px）：峰回收 dx=%+d dy=%+d' % (cdx, cdy))
assert abs(abs(cdx) - 23) <= 2 and abs(abs(cdy) - 17) <= 2, '自检失败，符号/索引约定不可信'
sgnx = 1 if cdx > 0 else -1
sgny = 1 if cdy > 0 else -1

Ae, Be = boundary(A), boundary(B)
dx, dy, sc = peak(Ae, Be)
# 自检已定符号：模型相对影像的位移(px) = (sgnx*dx, sgny*dy)，x 向东、y 向南
mdx, mdy = sgnx * dx, sgny * dy
print('平移峰：dx=%+d dy=%+d px ⇒ 模型相对影像 ΔE=%+.1f m，ΔN=%+.1f m（峰 %.0f / 影像边界 %d 点）'
      % (dx, dy, mdx * mperpx, -mdy * mperpx, sc, int(Be.sum())))

best = None
for ang in (-3, -2, -1, 0, 1, 2, 3):
    Ar = np.asarray(Image.fromarray((A * 255).astype(np.uint8)).rotate(ang, resample=Image.NEAREST, expand=False)) > 127
    dxx, dyy, scc = peak(boundary(Ar), Be)
    print('  转 %+d°：峰 %+d,%+d（%.0f）' % (ang, dxx, dyy, scc))
    if best is None or scc > best[3]:
        best = (ang, dxx, dyy, scc)
print('最优：转 %+d° + 平移 %+d,%+d px' % best[:3])


def edge_diff(Ax, Bx):
    out = []
    for y in range(N):
        xa = np.nonzero(Ax[y])[0]
        xb = np.nonzero(Bx[y])[0]
        if len(xa) == 0 or len(xb) == 0:
            continue
        out.append(((xa.max() + xa.min()) / 2 - (xb.max() + xb.min()) / 2))
    return np.array(out) if out else np.array([])


dv = edge_diff(A, B)
if len(dv):
    q = [float(np.median(dv[i * len(dv) // 4:(i + 1) * len(dv) // 4])) * mperpx for i in range(4)]
    print('逐行水面左右缘中点差：中位 %+.1f m（MAD %.1f m，%d 行）｜ 四分位 %s'
          % (np.median(dv) * mperpx, np.median(np.abs(dv - np.median(dv))) * mperpx, len(dv),
             ' | '.join('%+.0f' % v for v in q)))


def shore_diff(Ax, Bx):
    out = []
    for y in range(N):
        xa = np.nonzero(Ax[y])[0]
        xb = np.nonzero(Bx[y])[0]
        if len(xa) == 0 or len(xb) == 0:
            continue
        ma, mb = int(xa.max()), int(xb.max())
        if ma >= N - 2 or mb >= N - 2:
            continue
        out.append(ma - mb)
    return np.array(out)


sv = shore_diff(A, B)
if len(sv):
    svmed = float(np.median(sv))
    print('东侧水缘（右缘水像素）差：中位 %+.1f m（MAD %.1f m，%d 行）｜ P10/25/50/75/90 = %s'
          % (svmed * mperpx, float(np.median(np.abs(sv - svmed))) * mperpx, len(sv),
             ' / '.join('%+.0f' % (np.percentile(sv, p) * mperpx) for p in (10, 25, 50, 75, 90))))
