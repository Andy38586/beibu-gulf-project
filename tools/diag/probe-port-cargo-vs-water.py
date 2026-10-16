# -*- coding: utf-8 -*-
"""probe-port-cargo-vs-water.py — 只读：港区交付包「集装箱是不是压在水面上」。

背景（任务表 §8.7「仍需验证 ①」）：qinzhou-port 层自 2026-10-03 改回**交付包原版**
`backend/static/qinzhou-port/tiles/tileset.json`（含 cargo 材质）后，「整排箱子压在
水面上」是否复现**未取证**（当年 `3a29a6f6` 的自建集装箱正是为此加了水面掩膜）。

读法：与 `probe-hub-heights.py` 同一套——tileset 逐级变换（列主序）× glTF 顶点
Y-up→Z-up（`(x, −z, y)`）→ ECEF → WGS84 **椭球高**，按材质名分桶取分位数。

判定面（启发式，阈值写在输出里，不做隐式推断）：
  · 堆场面 = rail / concrete / opaque 三种材质高度合并后的中位；
  · 水面   = water 材质的中位；
  · cargo 底面 = cargo 材质高度的 P5。
  cargo P5 与水面相差 ≤ 1.0 m **且** 低于堆场面 > 1.0 m ⇒ 判"压在水面"（exit 1）；
  否则 exit 0，并把三面相对关系打印出来（数值本身才是证据）。

用法（venv python）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 tools/diag/probe-port-cargo-vs-water.py
缺交付包时退出码 2（未取证，不算通过也不算红）。
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TILES = os.path.join(ROOT, 'backend/static/qinzhou-port/tiles')
TILESET = os.path.join(TILES, 'tileset.json')
sys.path.insert(0, os.path.join(ROOT, 'tools', 'lib'))
from geo import ecef_to_geo  # noqa: E402
from glb import accessor, read_glb  # noqa: E402

WATER_HINT = ('water', 'sea')
YARD_HINT = ('rail', 'concrete', 'opaque', 'asphalt', 'ground')
CARGO_HINT = ('cargo', 'container', 'box')



def mul(a, b):
    return [sum(a[k * 4 + i] * b[j * 4 + k] for k in range(4)) for j in range(4) for i in range(4)]


def ap(m, p):
    return [m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i] for i in range(3)]


def ecef2llh(P):
    return ecef_to_geo(P)  # 实现唯一位于 tools/lib/geo.py（P4 收口）


def bucket(name: str):
    n = (name or '').lower()
    if any(k in n for k in CARGO_HINT):
        return 'cargo'
    if any(k in n for k in WATER_HINT):
        return 'water'
    if any(k in n for k in YARD_HINT):
        return 'yard'
    return 'other:' + (name or '?')


def on_water_verdict(cargo_p5, water_med, yard_med, tol=1.0):
    """启发式红条件：cargo 底面贴水面（|Δ|≤tol）且低于堆场面 >tol。返回 (bool, 三个差)。"""
    return (abs(cargo_p5 - water_med) <= tol and (yard_med - cargo_p5) > tol), (
        cargo_p5 - water_med, cargo_p5 - yard_med, yard_med - water_med)


def selftest() -> int:
    """同形态阳性对照：合成本例跑判据（红例必须红、绿例必须绿）。"""
    red, _ = on_water_verdict(cargo_p5=-18.3, water_med=-18.3, yard_med=-16.9)
    green, _ = on_water_verdict(cargo_p5=-16.4, water_med=-18.3, yard_med=-16.9)
    print('selftest：红例(cargo 底面贴水面) = %s（期望 True）｜绿例(cargo 在堆场面上) = %s（期望 False）'
          % (red, green))
    ok = red is True and green is False
    print('selftest %s' % ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1


def main() -> int:
    if '--selftest' in sys.argv:
        return selftest()
    if not os.path.exists(TILESET):
        print('缺交付包：%s（.gitignore 排除，未取证）' % TILESET)
        return 2
    ts = json.load(open(TILESET, encoding='utf-8'))
    data = {}
    uris = []

    def walk(node, M):
        Wm = mul(M, node['transform']) if node.get('transform') else M
        uri = (node.get('content') or {}).get('uri') or ''
        p = os.path.join(TILES, uri) if uri else None
        if p and os.path.exists(p):
            uris.append(uri)
            j, b = read_glb(p)
            mats = j.get('materials') or [{}]
            M3 = np.array([[Wm[0], Wm[1], Wm[2]], [Wm[4], Wm[5], Wm[6]], [Wm[8], Wm[9], Wm[10]]])
            Tt = np.array(Wm[12:15])
            for mesh in j.get('meshes', []):
                for pr in mesh['primitives']:
                    mi = pr.get('material')
                    if 'POSITION' not in pr.get('attributes', {}):
                        continue
                    pos = accessor(j, b, pr['attributes']['POSITION']).astype(np.float64)
                    P = np.empty_like(pos)
                    P[:, 0] = pos[:, 0]
                    P[:, 1] = -pos[:, 2]
                    P[:, 2] = pos[:, 1]
                    _lo, _la, h = ecef2llh(P @ M3 + Tt)
                    name = mats[mi].get('name', 'mat%d' % mi) if mi is not None else 'no-material'
                    data.setdefault(bucket(name), []).append(h)
        for c in node.get('children', []):
            walk(c, Wm)

    walk(ts['root'], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    print('交付包 %s' % TILESET)
    print('内容瓦片 %d 个（含 cargo 的瓦片见下）' % len(uris))

    joined = {k: np.concatenate(v) for k, v in data.items()}
    for k in sorted(joined):
        h = joined[k]
        print('  %-22s n=%8d ｜ P1 %8.2f ｜ P5 %8.2f ｜ 中位 %8.2f ｜ P95 %8.2f ｜ max %8.2f'
              % (k, len(h), np.percentile(h, 1), np.percentile(h, 5), np.median(h),
                 np.percentile(h, 95), h.max()))
    for need in ('cargo', 'water', 'yard'):
        if need not in joined:
            print('⚠ 缺 %s 材质桶 —— 判定不可做（mat 命名变化？）' % need)
            return 2
    cargo = joined['cargo']
    water = float(np.median(joined['water']))
    yard = float(np.median(joined['yard']))
    cargo_p5 = float(np.percentile(cargo, 5))
    print('三面关系：cargo P5 %.2f m ｜ 水面中位 %.2f m ｜ 堆场面中位 %.2f m'
          % (cargo_p5, water, yard))
    print('  cargo P5 − 水面 = %+.2f m；cargo P5 − 堆场面 = %+.2f m；堆场面 − 水面 = %+.2f m'
          % (cargo_p5 - water, cargo_p5 - yard, yard - water))
    red, _ = on_water_verdict(cargo_p5, water, yard)
    if red:
        print('❌ 判"压在水面"：cargo 底面贴水面且低于堆场面（启发式阈值 1.0 m）')
        return 1
    print('✅ 未见"整排箱子压在水面"形态（cargo 底面与水面/堆场面的关系不满足启发式红条件）')
    print('   注意：这是几何面判据；"看感"仍以页面截图为准（本探针不作视觉结论）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
