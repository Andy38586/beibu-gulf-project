# -*- coding: utf-8 -*-
"""port-quay-offset.py — 港区交付包 vs 天地图 10-05 影像的**对位量化**（N4/B2，只读源+写 .local）。

## 结论先写（2026-10-05 实跑）
逐行岸缘差（本脚本保留口径）**通过合成自检**（纯 dx ±30 px ⇒ Δx ∓30 px 逐位回收）。实跑
n=93 行：中位 −52 m / MAD 70 m；分段 = 北段 −45±34 m、中段 −105±28 m、南段 +257±103 m
（**符号不一致**）。差集中在**跨泊位/突堤结构行**（y=2100 实测：模型陆地 100% 覆盖、
影像水面 88% ⇒ 模型结构比影像更向海伸出 ≈120 m），平直岸段行差在 ±50 m 内。
⇒ **无单一平移可修正；建议接受当前对位**——差异是交付包几何（泊位/岸线简化）与现状的
分段不一致，任何整体平移都会让其余岸段变差。已试过且**不适用**的口径（勿重走）：
  ① FFT 边界 chamfer 全窗最小均值 46.4 m（零平移 48.1 m，增益 <2 m）——阶梯岸线无对应边；
  ② 水面掩膜面积重叠 97.3%（零平移同值）——开放海面主导、对平移不敏感；
  ③ 逐岸线最近邻位移——**未通过合成自检**（影像掩膜整体平移 (40,−25) px 后读数仍 (0,0)：
     该尺量的是"到最近边的局部距离"，对应关系不确定，天然看不见整体平移）⇒ 作废不采用。
（探索版脚本与叠加图留档 `.local/port-align2/`。）

## 本脚本口径
  模型侧：交付包 water 材质 ∧ ¬陆地材质 = 可见水面；逐行取"自西侧第一段连续水的东缘"（≤45 px
  缺口容差）为模型岸缘；影像侧同法（先做 1×61 横向闭运算桥接分类碎片）。
  Δx(y) = 模型缘 − 影像缘（px；负 = 模型水更窄/陆地更向海伸出）。
用法（venv，需 numpy/Pillow/scipy；前置=交付包 tiles 在盘 + fetch-imagery 拉好的影像）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 tools/diag/port-quay-offset.py \
      [--imagery .local/3d-review/port-r1.jpg]
  产出：.local/port-align2/port-quay-offset-overlay.png（红=模型岸缘、青=影像水边界）
"""
import argparse, json, math, os, struct
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, '.local', 'port-align2')

ap = argparse.ArgumentParser()
ap.add_argument('--imagery', default=os.path.join('.local', '3d-review', 'port-r1.jpg'))
ap.add_argument('--tiles', default=os.path.join('backend', 'static', 'qinzhou-port', 'tiles'))
a = ap.parse_args()
IMG = a.imagery if os.path.isabs(a.imagery) else os.path.join(ROOT, a.imagery)
TILES = a.tiles if os.path.isabs(a.tiles) else os.path.join(ROOT, a.tiles)
os.makedirs(OUT, exist_ok=True)

bj = json.load(open(os.path.splitext(IMG)[0] + '.json', encoding='utf-8'))
w, s, e, n = bj['bbox']
im = Image.open(IMG).convert('RGB')
W, H = im.size
mperpx_e = (e - w) * 111320.0 * math.cos(math.radians((s + n) / 2)) / W
mperpx_n = (n - s) * 110540.0 / H
mperpx = (mperpx_e + mperpx_n) / 2
print('影像 %dx%d bbox=[%.5f,%.5f,%.5f,%.5f] %.3f m/px' % (W, H, w, s, e, n, mperpx))

# ---------- 影像水面 ----------
rgb = np.asarray(im).astype(np.float32)
gray = rgb.mean(axis=2)
mu = ndimage.uniform_filter(gray, 5)
sq = ndimage.uniform_filter(gray * gray, 5)
sd = np.sqrt(np.maximum(sq - mu * mu, 0))
water_i = (gray < 85) & (sd < 12) & ((rgb[..., 2] - rgb[..., 0]) > 4)
water_i = ndimage.binary_closing(water_i, iterations=3)
water_i = ndimage.binary_opening(water_i, iterations=1)
print('影像水面 %.2f%%' % (water_i.mean() * 100))

# ---------- 交付包 water / 陆地两类材质 ----------
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
    ac = j['accessors'][i]
    bv = j['bufferViews'][ac['bufferView']]
    fmt, sz = CS[ac['componentType']]
    nc = NC[ac['type']]
    st = bv.get('byteStride') or sz * nc
    base = bv.get('byteOffset', 0) + ac.get('byteOffset', 0)
    arr = np.frombuffer(b, dtype=np.dtype('<' + fmt), count=ac['count'] * nc, offset=base)
    if st == sz * nc:
        return arr.reshape(ac['count'], nc)
    return np.array(np.lib.stride_tricks.as_strided(arr, shape=(ac['count'], nc), strides=(st, sz)))

def mul(x, y):
    o = [0.0] * 16
    for i in range(4):
        for j in range(4):
            o[i * 4 + j] = sum(x[k * 4 + j] * y[i * 4 + k] for k in range(4))
    return o

A_, F = 6378137.0, 1 / 298.257223563
E2 = F * (2 - F)

def ecef2ll(E):
    x, y, z = E[:, 0], E[:, 1], E[:, 2]
    lng = np.degrees(np.arctan2(y, x))
    p2 = np.sqrt(x * x + y * y)
    lat = np.arctan2(z, p2 * (1 - E2))
    for _ in range(6):
        Nn = A_ / np.sqrt(1 - E2 * np.sin(lat) ** 2)
        h = p2 / np.cos(lat) - Nn
        lat = np.arctan2(z, p2 * (1 - E2 * Nn / (Nn + h)))
    return lng, np.degrees(lat)

ts = json.load(open(os.path.join(TILES, 'tileset.json'), encoding='utf-8'))
tris_w, tris_l, nodes, missing = [], [], [0], [0]

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
                    nm = mats[mi].get('name', '') if mi is not None else ''
                    pos = acc(j, b, pr['attributes']['POSITION']).astype(np.float64)
                    P = np.empty_like(pos)
                    P[:, 0] = pos[:, 0]
                    P[:, 1] = -pos[:, 2]
                    P[:, 2] = pos[:, 1]
                    lng, lat = ecef2ll(P @ M3 + Tt)
                    X = (lng - w) / (e - w) * W
                    Y = (n - lat) / (n - s) * H
                    ind = (acc(j, b, pr['indices']).reshape(-1).astype(np.int64)
                           if 'indices' in pr else np.arange(len(pos), dtype=np.int64))
                    ind = ind[:(len(ind) // 3) * 3].reshape(-1, 3)
                    xs, ys = X[ind], Y[ind]
                    keep = ((xs > -300) & (xs < W + 300)).any(1) & ((ys > -300) & (ys < H + 300)).any(1)
                    if keep.sum():
                        tgt = tris_w if nm == 'water' else tris_l
                        for t in ind[keep]:
                            tgt.append((X[t].copy(), Y[t].copy()))
    for c in node.get('children', []):
        walk(c, Wm)

walk(ts['root'], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

def raster(tris):
    m = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(m)
    for tx, ty in tris:
        d.polygon(list(zip(tx.tolist(), ty.tolist())), fill=255)
    return np.asarray(m) > 0

water_m, land_m = raster(tris_w), raster(tris_l)
vis = water_m & ~land_m
print('瓦片 %d / 缺 %d ｜ 水材质 %.2f%% ｜ 陆地材质 %.2f%% ｜ 可见水面 %.2f%%'
      % (nodes[0], missing[0], water_m.mean() * 100, land_m.mean() * 100, vis.mean() * 100))

def boundary(m):
    b = np.zeros_like(m)
    b[1:, :] |= m[1:, :] & ~m[:-1, :]
    b[:-1, :] |= m[:-1, :] & ~m[1:, :]
    b[:, 1:] |= m[:, 1:] & ~m[:, :-1]
    b[:, :-1] |= m[:, :-1] & ~m[:, 1:]
    return b

coast = boundary(vis) & ndimage.binary_dilation(land_m, iterations=2)
print('模型岸线 %d px' % int(coast.sum()))

# ---------- 逐行岸缘差（唯一通过合成自检的口径） ----------
def east_edge(row, gap_max=45):
    w = np.nonzero(row)[0]
    if len(w) == 0 or w[0] > 30:
        return None
    x, gap, last = w[0], 0, w[0]
    while x < len(row) and gap <= gap_max:
        if row[x]:
            last, gap = x, 0
        else:
            gap += 1
        x += 1
    return last + 1

def corridor(mask_i, rows):
    mi = ndimage.binary_closing(mask_i, structure=np.ones((1, 61), bool))
    out = {}
    for y in rows:
        em, ei = east_edge(vis[y]), east_edge(mi[y])
        if em is None or ei is None or em > W - 80 or ei > W - 80:
            continue
        out[y] = em - ei
    return out

rows = list(range(1000, 3450, 25))
base = corridor(water_i, rows)
d = np.array(list(base.values()))
print('逐行岸缘差（模型缘−影像缘，负=模型水更窄/陆地更向海伸出）：n=%d ｜ 中位 %+.1f px = %+.1f m ｜ MAD %.1f m ｜ P25/P75 = %+.1f/%+.1f m'
      % (len(d), np.median(d), np.median(d) * mperpx, np.median(np.abs(d - np.median(d))) * mperpx,
         np.percentile(d, 25) * mperpx, np.percentile(d, 75) * mperpx))
for lo, hi, name in [(1000, 1800, '北段'), (1800, 2600, '中段'), (2600, 3450, '南段')]:
    q = np.array([v for y, v in base.items() if lo <= y < hi])
    if len(q):
        print('  %s y%d~%d: n=%d ｜ 中位 %+.1f m ｜ MAD %.1f m ｜ 范围 %+.1f~%+.1f m'
              % (name, lo, hi, len(q), np.median(q) * mperpx,
                 np.median(np.abs(q - np.median(q))) * mperpx, q.min() * mperpx, q.max() * mperpx))

# 合成自检：影像掩膜纯 dx 平移 ±30 px ⇒ Δx 必须整体回收 ∓30 px（对应关系可证）
for dx0 in (30, -30):
    t = corridor(np.roll(water_i, (0, dx0), axis=(0, 1)), rows)
    med = float(np.median([t[y] - base[y] for y in base if y in t]))
    print('自检：影像掩膜 dx %+d px → Δx 整体变化 %+.1f px（期望 %+d）' % (dx0, med, -dx0))
    assert abs(med + dx0) <= 2, '自检失败：逐行岸缘差口径不可信'

# ---------- 目视对照件 ----------
a2 = np.asarray(im).astype(np.float32).copy()
a2[land_m] = a2[land_m] * 0.65 + np.array([0, 200, 0]) * 0.35
a2[vis] = a2[vis] * 0.55 + np.array([40, 90, 255]) * 0.45
bd = ndimage.binary_dilation(boundary(vis), iterations=2)
a2[bd] = [255, 40, 40]
bi = ndimage.binary_dilation(boundary(water_i), iterations=2) & ~bd
a2[bi] = [0, 220, 255]
Image.fromarray(a2.astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS).save(
    os.path.join(OUT, 'port-quay-offset-overlay.png'))
print('WROTE .local/port-align2/port-quay-offset-overlay.png（红=模型岸线 青=影像水边界 绿=模型陆地 蓝=可见水面）')
