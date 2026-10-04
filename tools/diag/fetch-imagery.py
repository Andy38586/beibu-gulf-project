# -*- coding: utf-8 -*-
"""fetch-imagery.py — 按给定中心拉天地图影像（z 可调），用于对齐参照（只读远端/写本地 jpg+json）。
与 tools/3dtiles-build/fetch-port-imagery.py 同源同做法（img_w / CGCS2000），只是参数化。
key 从 .env 的 VITE_TIANDITU_KEY 读，不硬编码。
用法（venv，需 Pillow）：
  backend/algorithm-service/.venv/Scripts/python.exe tools/diag/fetch-imagery.py \
    --lng 108.9373 --lat 22.4472 --zoom 17 --n 12 --out .local/3d-review/madao-r2
"""
import argparse, json, math, os, re, sys, urllib.request
from io import BytesIO
from PIL import Image

def read_key():
    for p in ('.env', 'frontend/.env', 'frontend/.env.local'):
        try:
            m = re.search(r'VITE_TIANDITU_KEY\s*=\s*(\S+)', open(p, encoding='utf-8').read())
            if m: return m.group(1)
        except OSError: pass
    raise SystemExit('找不到 VITE_TIANDITU_KEY')

ap = argparse.ArgumentParser()
ap.add_argument('--lng', type=float, required=True)
ap.add_argument('--lat', type=float, required=True)
ap.add_argument('--zoom', type=int, default=17)
ap.add_argument('--n', type=int, default=12)
ap.add_argument('--out', required=True)
a = ap.parse_args()
KEY = read_key()

def tile_xy(lng, lat, z):
    n = 2 ** z
    x = (lng + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y
def tile_lnglat(x, y, z):
    n = 2 ** z
    return x / n * 360.0 - 180.0, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))

cx, cy = tile_xy(a.lng, a.lat, a.zoom)
x0, y0 = int(cx) - a.n // 2, int(cy) - a.n // 2
canvas = Image.new('RGB', (256 * a.n, 256 * a.n))
ok = 0
for j in range(a.n):
    for i in range(a.n):
        col, row = x0 + i, y0 + j
        url = ('https://t%d.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
               '&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=%d&TILEROW=%d&TILECOL=%d&tk=%s'
               ) % (j % 8, a.zoom, row, col, KEY)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            canvas.paste(Image.open(BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGB'), (i * 256, j * 256))
            ok += 1
        except Exception as e:
            print('  瓦片 %d,%d 失败 %s' % (col, row, str(e)[:60]))
print('成功 %d/%d 瓦片' % (ok, a.n * a.n))
if ok == 0: sys.exit(1)
west, north = tile_lnglat(x0, y0, a.zoom)
east, south = tile_lnglat(x0 + a.n, y0 + a.n, a.zoom)
os.makedirs(os.path.dirname(a.out), exist_ok=True)
canvas.save(a.out + '.jpg', quality=90)
json.dump({'bbox': [round(west, 8), round(south, 8), round(east, 8), round(north, 8)], 'zoom': a.zoom,
           'size': [canvas.width, canvas.height], 'center': [a.lng, a.lat]}, open(a.out + '.json', 'w'), ensure_ascii=False)
print('WROTE %s.jpg %s bbox=%s' % (a.out, canvas.size, [round(west,5), round(south,5), round(east,5), round(north,5)]))
