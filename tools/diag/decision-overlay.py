# -*- coding: utf-8 -*-
"""decision-overlay.py — 马道枢纽"正位"决定图（只读）。

画到"按当前位置新拉"的天地图影像上：
  蓝  = 当前模型水面（water+poolWater）
  白  = 当前航道中心线（water 逐行连续段中心）
  橙  = 候选方位 193.3°（当前轴再逆时针 4.5°）
  绿  = 候选方位 188.8°（当前轴再逆时针 9.0°）
  黄  = OSM 平陆运河 relation 原线（osm-canal-geom.json）
  紫  = 我方运河带中心线（GLB 水面逐行中心）
  格子 = 20 m
用法（venv，需 numpy/Pillow）：
  backend/algorithm-service/.venv/Scripts/python.exe tools/diag/decision-overlay.py madao .local/3d-review/madao-r2
  # BASE = 影像词干（读 <BASE>.jpg + <BASE>.json）；候选轴用 --cand "deg,dir;..." 追加
  # OSM 参考线用 --osm <osm-canal-geom.json>（默认 .local/3d-review/…；缺失则跳过该层并提示）
  输出：.local/3d-review/decision-overlay-<hub>.png（不入库，只作决定图）
"""
import json, os, struct, sys, math
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB = sys.argv[1]
BASE = os.path.join(ROOT, sys.argv[2])
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
    return [struct.unpack_from('<' + fmt * nc, b, base + k * st) for k in range(a['count'])]


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


def to_lnglat(p):
    x, y, z = p
    lng = np.degrees(np.arctan2(y, x))
    p2 = np.hypot(x, y)
    lat = np.arctan2(z, p2 * (1 - E2))
    for _ in range(8):
        N = A_ / np.sqrt(1 - E2 * np.sin(lat) ** 2)
        h = p2 / np.cos(lat) - N
        lat = np.arctan2(z, p2 * (1 - E2 * N / (N + h)))
    return lng, np.degrees(lat)


if os.path.exists(BASE + '.json'):
    meta = json.load(open(BASE + '.json'))
    w, s, e, n = meta['bbox']
    img = None
else:
    idx = json.load(open(os.path.join(ROOT, 'backend/static/pinglu/imagery/imagery.json'), encoding='utf-8'))
    ent = next(t for t in idx['tiles'] if t['name'] == os.path.basename(BASE))
    w, s, e, n = ent['bbox']
    img = Image.open(os.path.join(ROOT, 'backend/static/pinglu/imagery', ent['file'])).convert('RGB')
if img is not None:
    W, H = img.size
else:
    W = H = json.load(open(BASE + '.json'))['size'][0]
mperpx = (e - w) * 111320 * math.cos(math.radians((s + n) / 2)) / W

CANDS = [(4.5, '193.3'), (9.0, '188.8')]
if '--cand' in sys.argv:
    CANDS = [(float(p.split(',')[0]), p.split(',')[1]) for p in sys.argv[sys.argv.index('--cand') + 1].split(';')]
NOTE = []
if '--note' in sys.argv:
    NOTE = [sys.argv[sys.argv.index('--note') + 1]]


def px(lng, lat):
    return ((lng - w) / (e - w) * W, (n - lat) / (n - s) * H)


TILES = os.path.join(ROOT, 'backend/static/pinglu/tiles')
ts = json.load(open(os.path.join(TILES, 'tileset.json'), encoding='utf-8'))
center_ll = model_az = None
for c in ts['root']['children']:
    if ((c.get('content') or {}).get('uri') or '').startswith(HUB + '-'):
        b = c['boundingVolume']['box']
        center_ll = to_lnglat(ap(ts['root']['transform'], ap(c['transform'], [b[0], b[1], b[2]])))
        model_az = (math.degrees(math.atan2(c['transform'][0], c['transform'][1])) + 360) % 360
        break
x0, y0 = px(*center_ll)

# 自检：候选标注方位角必须等于"当前方位 − alpha"（正 alpha = 逆时针 = 方位角减小）。
for _a, _lab in CANDS:
    want = (model_az - _a) % 360
    diff = ((want - float(_lab) + 540) % 360) - 180
    if abs(diff) > 0.3:
        sys.exit('候选自检失败：alpha %+0.1f 标注 %s°，应为 %.2f°（差 %+.2f°）' % (_a, _lab, want, diff))

fill_tris = []


def walk(node, M):
    Wm = mul(M, node['transform']) if node.get('transform') else M
    uri = (node.get('content') or {}).get('uri') or ''
    if uri.startswith(HUB + '-') and os.path.exists(os.path.join(TILES, uri)):
        j, bin_ = read_glb(os.path.join(TILES, uri))
        for mesh in j['meshes']:
            for pr in mesh['primitives']:
                mn = (j.get('materials') or [{}])[pr.get('material', 0)].get('name', '')
                if mn not in ('water', 'poolWater'):
                    continue
                pos = acc(j, bin_, pr['attributes']['POSITION'])
                ind = acc(j, bin_, pr['indices']) if 'indices' in pr else None
                order = [i[0] for i in ind] if ind else list(range(len(pos)))
                flat = [px(*to_lnglat(ap(Wm, [pos[k][0], -pos[k][2], pos[k][1]]))) for k in order]
                for k in range(0, len(flat) - 2, 3):
                    t = [flat[k], flat[k + 1], flat[k + 2]]
                    if max(abs(q[0]) for q in t) > 1e6:
                        continue
                    fill_tris.append((t, mn))
    for c in node.get('children', []):
        walk(c, Wm)


walk(ts['root'], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
A = np.zeros((H, W), dtype=bool)
Bm = np.zeros((H, W), dtype=bool)
mi = Image.new('L', (W, H), 0)
dri = ImageDraw.Draw(mi)
for t, mn in fill_tris:
    if mn == 'water':
        dri.polygon(t, fill=1)
A |= np.asarray(mi) > 0
mi2 = Image.new('L', (W, H), 0)
dri2 = ImageDraw.Draw(mi2)
ct = json.load(open(os.path.join(ROOT, 'backend/static/pinglu/canal/tileset.json'), encoding='utf-8'))
cj, cb = read_glb(os.path.join(ROOT, 'backend/static/pinglu/canal', ct['root']['content']['uri'].split('/')[-1]))
Tc = ct['root']['transform']
for mesh in cj['meshes']:
    for pr in mesh['primitives']:
        if 'water' not in (cj.get('materials') or [{}])[pr.get('material', 0)].get('name', ''):
            continue
        pos = acc(cj, cb, pr['attributes']['POSITION'])
        ind = acc(cj, cb, pr['indices']) if 'indices' in pr else None
        order = [i[0] for i in ind] if ind else list(range(len(pos)))
        flat = [px(*to_lnglat(ap(Tc, [pos[k][0], -pos[k][2], pos[k][1]]))) for k in order]
        for k in range(0, len(flat) - 2, 3):
            t = [flat[k], flat[k + 1], flat[k + 2]]
            if max(abs(q[0]) for q in t) > 1e6:
                continue
            dri2.polygon(t, fill=255)
Bm |= np.asarray(mi2) > 0


def row_runs(mask, y, minpx=8):
    xs = np.nonzero(mask[y])[0]
    out = []
    if len(xs) == 0:
        return out
    st = pv = xs[0]
    for x in xs[1:]:
        if x != pv + 1:
            if pv - st + 1 >= minpx:
                out.append(((st + pv) / 2.0, pv - st + 1))
            st = x
        pv = x
    if pv - st + 1 >= minpx:
        out.append(((st + pv) / 2.0, pv - st + 1))
    return out


half = int(1300 / mperpx)


def track(mask, x_init):
    ys = xc = None
    for dy in range(0, 400):
        for y in (int(y0) - dy, int(y0) + dy):
            if 0 <= y < H:
                rr = row_runs(mask, y)
                if rr:
                    ys, xc = y, min(rr, key=lambda r: abs(r[0] - x_init))[0]
                    break
        if ys is not None:
            break
    if ys is None:
        return []
    pts = {ys: xc}
    for direction in (1, -1):
        y, xp = ys + direction, xc
        while 0 <= y < H and abs(y - y0) <= half:
            rr = row_runs(mask, y)
            if rr:
                xp = min(rr, key=lambda r: abs(r[0] - xp))[0]
                pts[y] = xp
            y += direction
    return sorted(pts.items())


cur = track(A, x0)
band = track(Bm, x0)

if img is None:
    img = Image.open(BASE + '.jpg')
img = img.convert('RGBA')
layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
dl = ImageDraw.Draw(layer)
for t, mn in fill_tris:
    dl.polygon(t, fill=(40, 120, 255, 80) if mn == 'water' else (40, 120, 255, 40))
img = Image.alpha_composite(img, layer)
dr = ImageDraw.Draw(img, 'RGBA')


def rot(pts, alpha_deg):
    a = math.radians(alpha_deg)
    ca, sa = math.cos(a), math.sin(a)
    return [(x0 + (x - x0) * ca + (y - y0) * sa, y0 - (x - x0) * sa + (y - y0) * ca) for x, y in pts]


cur_xy = [(x, y) for y, x in cur]
if len(cur_xy) > 1:
    dr.line(cur_xy, fill=(255, 255, 255, 255), width=3)
COLS = [(255, 140, 0, 255), (0, 220, 90, 255), (255, 0, 180, 255), (0, 200, 255, 255)]
for k, (alpha, label) in enumerate(CANDS):
    pts = rot(cur_xy, alpha)
    if len(pts) > 1:
        dr.line(pts, fill=COLS[k % len(COLS)], width=3)
band_xy = [(x, y) for y, x in band]
if len(band_xy) > 1:
    dr.line(band_xy, fill=(255, 0, 255, 255), width=3)

_osm = '.local/3d-review/osm-canal-geom.json'
if '--osm' in sys.argv:
    _osm = sys.argv[sys.argv.index('--osm') + 1]
_osm_path = _osm if os.path.isabs(_osm) else os.path.join(ROOT, _osm)
if not os.path.exists(_osm_path):
    print('WARN: OSM 参考线缺（%s），该层跳过' % _osm_path)
    oj = {'elements': []}
else:
    oj = json.load(open(_osm_path, encoding='utf-8'))
rel = (oj.get('elements') or [None])[0]
if rel:
    for m in rel['members']:
        g = m.get('geometry') or []
        pts = [px(p['lon'], p['lat']) for p in g]
        pts = [(x, y) for x, y in pts if -2000 < x < W + 2000 and -2000 < y < H + 2000]
        if len(pts) > 1:
            dr.line(pts, fill=(255, 230, 0, 255), width=3)

step = max(1, int(round(20 / mperpx)))
for x in range(0, W, step):
    dr.line([(x, 0), (x, H)], fill=(255, 255, 255, 45))
for y in range(0, H, step):
    dr.line([(0, y), (W, y)], fill=(255, 255, 255, 45))
dr.line([(x0 - 12, y0), (x0 + 12, y0)], fill=(0, 0, 0, 255), width=3)
dr.line([(x0, y0 - 12), (x0, y0 + 12)], fill=(0, 0, 0, 255), width=3)

legend = [
    'model axis now: %.1f deg' % model_az,
    'BLUE fill   = model water now',
    'WHITE line  = model canal centerline (now)',
    'YELLOW line = OSM relation line (raw)',
    'MAGENTA     = our canal band centerline',
    'grid = 20 m ; black cross = rotation center',
]
for k, (alpha, label) in enumerate(CANDS):
    dlt = ((float(label) - model_az + 540) % 360) - 180
    legend.insert(3 + k, 'CAND%-2d line = candidate %s deg (bearing %+0.1f vs now)' % (k + 1, label, dlt))
legend += NOTE
for i, sline in enumerate(legend):
    dr.text((10, 10 + i * 16), sline, fill=(255, 255, 0, 255))
o = os.path.join(ROOT, '.local/3d-review', 'decision-overlay-%s.png' % HUB)
img.convert('RGB').save(o)


def sep(alpha):
    pts = rot(cur_xy, alpha)
    if not pts:
        return None
    out = []
    for lo, hi in ((y0 + 0.7 * half, 1e9), (-1e9, y0 - 0.7 * half)):
        idx = [i for i, (x, y) in enumerate(cur_xy) if lo <= y <= hi]
        out.append(float(np.mean([pts[i][0] - cur_xy[i][0] for i in idx])) * mperpx if idx else float('nan'))
    return out


print('WROTE %s %s m/px=%.3f 模型水面 %d px 带 %d px 中心线 %d 点'
      % (o, img.size, mperpx, int(A.sum()), int(Bm.sum()), len(cur_xy)))
for alpha, lab in CANDS:
    d = sep(alpha)
    if d:
        print('  候选 %s：南端横移 %+.0f m ｜ 北端横移 %+.0f m（相对当前中心线，东+）'
              % (lab, d[0] if len(d) > 0 else float('nan'), d[1] if len(d) > 1 else float('nan')))
