# -*- coding: utf-8 -*-
"""probe-3dtiles-facing.py — 只读「朝向体检」：逐图元抽样算三角面几何法线 vs 顶点声明法线。

为什么：四边形绕序反了**不报错、不缺瓦片、包围盒照旧**，只在 Cesium 默认 backFaceCulling
下整层不可见（2026-10-04 实测：港区道路层 0.00% 像素、运河带 6.71%→12.18%；城区五桥画内壁）。
静态读 GLB 也看不出它，除非算这条叉积。判据 = dot(几何法线, 声明法线) > 0 的三角面占比
（越接近 100% 越好；单面材质下 <100% 即"有的面在背面剔除下消失"）。

用法（venv，需 numpy）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 \
    tools/diag/probe-3dtiles-facing.py [--sample 200]
  # 单文件模式（阳性对照/临时产物）：--glb <path.glb>
退出码：0 = 全部在盘产物 ✅；1 = 有产物 <99% 正向（红）；2 = 一个产物都没在盘
（交付包与部分自建目录在 .gitignore 排除，需先重建/取回）。
"""
from __future__ import annotations

import glob
import json
import struct
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
CS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
SAMPLE = 200
if '--sample' in sys.argv:
    SAMPLE = int(sys.argv[sys.argv.index('--sample') + 1])


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


def audit_glb(p, label):
    j, b = read_glb(p)
    mats = j.get('materials') or [{}]
    rows = []
    for mesh in j['meshes']:
        for pr in mesh['primitives']:
            pos = acc(j, b, pr['attributes']['POSITION']).astype(np.float64)
            idx = acc(j, b, pr['indices']).reshape(-1).astype(np.int64) if 'indices' in pr else np.arange(len(pos))
            tri = idx.reshape(-1, 3)
            if len(tri) == 0:
                continue
            step = max(1, len(tri) // SAMPLE)
            A = pos[tri[::step, 0]]
            B = pos[tri[::step, 1]]
            C = pos[tri[::step, 2]]
            g = np.cross(B - A, C - A)
            L = np.linalg.norm(g, axis=1)
            ok = L > 1e-9
            g = g[ok] / L[ok, None]
            mi = pr.get('material')
            nm = mats[mi].get('name', '?') if mi is not None else '?'
            if 'NORMAL' in pr['attributes']:
                nrm = acc(j, b, pr['attributes']['NORMAL']).astype(np.float64)[tri[::step, 0]][ok]
                nn = np.linalg.norm(nrm, axis=1)
                keep = nn > 1e-9
                dots = (g[keep] * (nrm[keep] / nn[keep, None])).sum(1)
                frac = float((dots > 0).mean()) * 100
                rows.append((nm, len(tri), frac, float(np.median(dots))))
            else:
                rows.append((nm, len(tri), float('nan'), float('nan')))
    bad = [r for r in rows if not np.isnan(r[2]) and r[2] < 99.0]
    flag = '❌' if bad else '✅'
    print(
        '%s %-24s %s'
        % (
            flag,
            label,
            '；'.join(
                '%s 三角%d 正向%.0f%%(dot中位%+.2f)' % (r[0], r[1], r[2], r[3]) for r in rows[:6]
            ),
        )
    )
    return len(bad)


def main():
    if '--glb' in sys.argv:
        p = Path(sys.argv[sys.argv.index('--glb') + 1])
        if not p.exists():
            print('缺输入：%s' % p)
            return 2
        return 1 if audit_glb(p, '单文件 ' + p.name) else 0

    targets = [
        ('交付包·枢纽(对照)', REPO / 'backend/static/pinglu/tiles/madao-z3-lock.glb'),
        ('交付包·港区(对照)', None),
        ('自建·运河带', REPO / 'backend/static/pinglu/canal/canal.glb'),
        ('自建·港区道路', REPO / 'backend/static/qinzhou-port/rebuilt/roads/roads.glb'),
        ('自建·港区地面(备选层)', REPO / 'backend/static/qinzhou-port/rebuilt/ground/ground.glb'),
    ]
    qz = sorted(glob.glob(str(REPO / 'backend/static/qinzhou-port/tiles/t4_*.glb')))
    if qz:
        targets[1] = ('交付包·港区(对照)', Path(qz[0]))
    for f in sorted(glob.glob(str(REPO / 'backend/static/qinzhou-port/rebuilt/cell_*.glb')))[:2]:
        targets.append(('自建·集装箱 cell ' + Path(f).name, Path(f)))
    for f in sorted(glob.glob(str(REPO / 'backend/static/qinzhou-port/rebuilt/models/*.glb'))):
        targets.append(('自建·集装箱模型 ' + Path(f).name, Path(f)))
    bd = REPO / 'backend/static/bridges-city'
    if bd.is_dir():
        for f in sorted(bd.iterdir()):
            if f.name.endswith('.glb'):
                targets.append(('自建·城区桥 ' + f.name, f))

    ran = bad_total = 0
    for nm, p in targets:
        if p is None or not Path(p).exists():
            print('   %-58s （不在盘，跳过）' % nm)
            continue
        ran += 1
        bad_total += audit_glb(p, nm)
    if not ran:
        print('没有任何产物在盘：交付包/自建目录都在 .gitignore 排除，需先重建或取回交付包')
        return 2
    print('\n体检 %d 个产物：%s' % (ran, '❌ %d 处 <99% 正向' % bad_total if bad_total else '✅ 全部 100% 正向'))
    return 1 if bad_total else 0


if __name__ == '__main__':
    sys.exit(main())
