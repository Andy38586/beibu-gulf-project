#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从钦州港施工影像生成**水面掩膜**（供集装箱放置裁剪用）。

## 判据（两版的血泪）

第一版只用「与海面采样色的距离 < 45」，结果把**码头、龙门架、阴影**全判成水面
（.local/3d-diag/mask-overlay.png 里青覆盖半个堆场），于是裁剪一直在剔**阴影里的
合法箱子**，真正压海的反而留下——压水像素 8.4% 三轮都不降。

第二版加两个条件：
  ① 色距收紧到 < 30；
  ② **局部纹理低**（5x5 标准差 < 4）——海面平滑，码头/箱区/阴影都有结构。
再腐蚀 2 次去小块。

用法：python tools/3dtiles-build/make-water-mask.py
"""
import base64
import json
import os
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
gray = a.mean(axis=2)

# 海面采样：左下角 6%x6%（该处必为外海）
sea = a[int(N * 0.94):N, 0:int(N * 0.06)].reshape(-1, 3).mean(axis=0)
dist = np.sqrt(((a - sea) ** 2).sum(axis=2))

# 局部纹理（BoxBlur 近似 5x5 均值 → 方差）
gm = Image.fromarray(gray.astype(np.uint8)).filter(ImageFilter.BoxBlur(2))
g2 = Image.fromarray((gray * gray / 255.0).clip(0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2))
mean = np.asarray(gm, dtype=np.float32)
mean2 = np.asarray(g2, dtype=np.float32)
tex = np.sqrt(np.maximum(mean2 - mean * mean / 255.0, 0))

cand = ((dist < 30) & (tex < 4.0)).astype(np.uint8)
im = Image.fromarray(cand * 255)
for _ in range(2):
    im = im.filter(ImageFilter.MinFilter(3))
im = im.filter(ImageFilter.MaxFilter(3))
water = np.asarray(im) > 127
print('海面采样色 RGB = %s   海面占比 %.1f%%' % (np.round(sea, 0), 100.0 * water.mean()))

packed = np.packbits(water.reshape(-1))
json.dump({
    'note': '水面掩膜（1=水面），1024x1024 位，行优先；由 tools/3dtiles-build/make-water-mask.py 从施工影像生成。判据：色距<30 且 5x5 局部标准差<4',
    'bbox': bb, 'size': N,
    'seaSampleRGB': [float(x) for x in sea],
    'bits': base64.b64encode(packed.tobytes()).decode('ascii'),
}, open(OUT, 'w', encoding='utf-8'))
print('写出 %s  %.1f KB' % (OUT, os.path.getsize(OUT) / 1024))
