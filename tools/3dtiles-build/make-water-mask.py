#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从钦州港施工影像生成**水面掩膜**（供集装箱放置裁剪用）。

为什么需要：交付包的 cargo 棱柱有几个跨在码头岸线上，按它们的位置排箱会把整排
集装箱排进海里（实测 8.3% 的模型像素压在海面上）。用户裁定「以施工影像为准」，
故用影像判水面。

判据：取影像左下角（海面）采样色的距离 < 45，再形态学腐蚀去小块——只认大片连通
水面。输出 1024x1024 位掩膜（base64），覆盖影像 bbox。

用法：python tools/3dtiles-build/make-water-mask.py
"""
import base64
import json
import numpy as np
from PIL import Image, ImageFilter

IMG = 'backend/static/qinzhou-port/imagery/port.jpg'
META = 'backend/static/qinzhou-port/imagery/imagery.json'
OUT = 'backend/static/qinzhou-port/imagery/water-mask.json'
N = 1024

img = Image.open(IMG).convert('RGB')
meta = json.load(open(META, encoding='utf-8'))
bb = meta['tiles'][0]['bbox']
a = np.asarray(img.resize((N, N), Image.LANCZOS), dtype=np.float32)
sea = a[int(N * 0.94):N, 0:int(N * 0.06)].reshape(-1, 3).mean(axis=0)
cand = (np.sqrt(((a - sea) ** 2).sum(axis=2)) < 45).astype(np.uint8)
im = Image.fromarray(cand * 255)
for _ in range(5):
    im = im.filter(ImageFilter.MinFilter(3))
im = im.filter(ImageFilter.MaxFilter(3))
water = (np.asarray(im) > 127)
print('海面采样色 RGB = %s   海面占比 %.1f%%' % (np.round(sea, 0), 100.0 * water.mean()))

packed = np.packbits(water.reshape(-1))
payload = {
    'note': '水面掩膜（1=水面），1024x1024 位，行优先；由 tools/3dtiles-build/make-water-mask.py 从施工影像生成',
    'bbox': bb, 'size': N,
    'seaSampleRGB': [float(x) for x in sea],
    'bits': base64.b64encode(packed.tobytes()).decode('ascii'),
}
json.dump(payload, open(OUT, 'w', encoding='utf-8'))
import os
print('写出 %s  %.1f KB' % (OUT, os.path.getsize(OUT) / 1024))
