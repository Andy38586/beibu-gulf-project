#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""拉取钦州港作业区的天地图影像（z=17，8x8 瓦片拼成 2048^2），作为对齐参照。

与 backend/static/pinglu/imagery 的三个枢纽同源同做法（天地图 img_w / CGCS2000）。
key 从 .env 的 VITE_TIANDITU_KEY 读，不硬编码。

用法：python tools/3dtiles-build/fetch-port-imagery.py
"""
import json, math, os, sys, urllib.request
from io import BytesIO
from PIL import Image

def read_key():
    import re
    for p in ('.env', 'frontend/.env', 'frontend/.env.local'):
        try:
            with open(p, encoding='utf-8') as f:
                m = re.search(r'VITE_TIANDITU_KEY\s*=\s*(\S+)', f.read())
                if m:
                    return m.group(1)
        except OSError:
            pass
    raise SystemExit('找不到 VITE_TIANDITU_KEY（在 .env / frontend/.env）')


KEY = read_key()
Z = 17
LNG, LAT = 108.6473, 21.6745
N = 8

def tile_xy(lng, lat, z):
    n = 2 ** z
    x = (lng + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y

def tile_lnglat(x, y, z):
    n = 2 ** z
    lng = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lng, lat

cx, cy = tile_xy(LNG, LAT, Z)
x0 = int(cx) - N // 2
y0 = int(cy) - N // 2
print('中心瓦片 %.2f,%.2f -> 起始 %d,%d' % (cx, cy, x0, y0))

canvas = Image.new('RGB', (256 * N, 256 * N))
ok = 0
for j in range(N):
    for i in range(N):
        col, row = x0 + i, y0 + j
        url = ('https://t%d.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile'
               '&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles'
               '&TILEMATRIX=%d&TILEROW=%d&TILECOL=%d&tk=%s') % (j % 8, Z, row, col, KEY)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            data = urllib.request.urlopen(req, timeout=30).read()
            im = Image.open(BytesIO(data)).convert('RGB')
            canvas.paste(im, (i * 256, j * 256))
            ok += 1
        except Exception as e:
            print('  瓦片 %d,%d 失败: %s' % (col, row, str(e)[:80]))
print('成功 %d/%d 瓦片' % (ok, N * N))
if ok == 0:
    sys.exit(1)

west, north = tile_lnglat(x0, y0, Z)
east, south = tile_lnglat(x0 + N, y0 + N, Z)
out_dir = 'backend/static/qinzhou-port/imagery'
os.makedirs(out_dir, exist_ok=True)
canvas.save(os.path.join(out_dir, 'port.jpg'), quality=88)
meta = {
    'note': '天地图影像单块拼接（z=17，8x8 瓦片）；bbox = [west, south, east, north]，EPSG:4326/CGCS2000',
    'tiles': [{
        'name': 'port', 'label': '钦州港作业区', 'file': 'port.jpg',
        'width': canvas.width, 'height': canvas.height, 'zoom': Z,
        'bbox': [round(west, 8), round(south, 8), round(east, 8), round(north, 8)],
        'source': '天地图 img_w（CGCS2000），单张拼接影像',
    }],
}
with open(os.path.join(out_dir, 'imagery.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, indent=1)
print('bbox = %s' % meta['tiles'][0]['bbox'])
print('写出 %s/port.jpg  %dx%d' % (out_dir, canvas.width, canvas.height))