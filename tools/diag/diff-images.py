"""diff-images.py — 只读：两张同尺寸截图的逐像素差占比（配 probe-3dtiles-runtime.cjs 的 A/B 截图）。

用法（需 Pillow）：python tools/diag/diff-images.py a.png b.png
判据：阈值 >12/255 记"不同"；全 0 即"两图完全相同 ⇒ 该层对画面零贡献"。
"""
import sys, os
from PIL import Image, ImageChops
a = Image.open(sys.argv[1]).convert('RGB'); b = Image.open(sys.argv[2]).convert('RGB')
d = ImageChops.difference(a, b).convert('L')
px = d.load(); w, h = d.size
n = 0; x0, y0, x1, y1 = w, h, -1, -1
for y in range(h):
    for x in range(w):
        if px[x, y] > 12:
            n += 1
            x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y)
tot = w * h
print('DIFF %d / %d px = %.2f%%' % (n, tot, 100.0 * n / tot))
if n:
    print('BBOX x[%d..%d] y[%d..%d]  (图 %dx%d)' % (x0, x1, y0, y1, w, h))
else:
    print('BBOX none — 两图完全相同 ⇒ 3D Tiles 对画面零贡献')
