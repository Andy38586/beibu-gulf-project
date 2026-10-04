# -*- coding: utf-8 -*-
"""preview-roads-vertfollow.py — 生成「逐顶点跟随」（§8.12b 口径 C）的 roads/ground 试验 GLB。

只写 .local/c-preview/，生产资产零改动；供 preview-roads-vertfollow.cjs 做运行时 A/B。
口径与 §8.12b 开工单一致：
  参考池 = 全交付包瓦片（tileset 全树去重）、材质 rail/concrete/opaque、4 m 格 >=3 点中位；
  最近格 r=48 m；roads u=ref+0.15、ground u=ref+0.05；无参考保原值。
两步跑法（仓库根）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 tools/diag/preview-roads-vertfollow.py
  node tools/diag/preview-roads-vertfollow.cjs
"""
import json
import struct
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

REPO = Path(__file__).resolve().parents[2]
PORT = REPO / 'backend/static/qinzhou-port'
OUT = REPO / '.local/c-preview'
OUT.mkdir(parents=True, exist_ok=True)
CELL, R = 4.0, 48.0
CS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_chunks(p):
    b = open(p, 'rb').read()
    off, js, bn = 12, None, None
    while off + 8 <= len(b):
        ln, ty = struct.unpack_from('<II', b, off)
        d = b[off + 8:off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(d)
        elif ty == 0x004E4942:
            bn = bytearray(d)
        off += 8 + ln
    return js, bn


def write_glb(p, js, bn):
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bytes(bn)
    bb += b'\x00' * ((4 - len(bb) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    with open(p, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack('<II', len(bb), 0x004E4942))
        f.write(bb)


def get_pos(js, bn, ai):
    a = js['accessors'][ai]
    bv = js['bufferViews'][a['bufferView']]
    assert a['componentType'] == 5126 and a['type'] == 'VEC3', a
    assert bv.get('byteStride') in (None, 12), bv
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(bn, dtype='<f4', count=a['count'] * 3, offset=base).reshape(a['count'], 3)
    return arr, base


def build_grid():
    d = PORT / 'tiles'
    ts = json.load(open(d / 'tileset.json', encoding='utf-8'))
    seen, cells = set(), {}

    def rec(n):
        uri = (n.get('content') or {}).get('uri') or ''
        if uri and uri not in seen:
            seen.add(uri)
            p = d / uri
            if p.exists():
                js2, bn2 = read_chunks(p)
                mats = js2.get('materials') or [{}]
                for mesh in js2['meshes']:
                    for pr in mesh['primitives']:
                        mi = pr.get('material')
                        nm = mats[mi].get('name', '?') if mi is not None else '?'
                        if nm not in ('rail', 'concrete', 'opaque'):
                            continue
                        pos, _ = get_pos(js2, bn2, pr['attributes']['POSITION'])
                        E = pos[:, 0].astype(np.float64)
                        N = -pos[:, 2].astype(np.float64)
                        U = pos[:, 1].astype(np.float64)
                        k = np.floor(np.stack([E, N], 1) / CELL).astype(np.int64)
                        for i in range(len(pos)):
                            cells.setdefault((int(k[i, 0]), int(k[i, 1])), []).append(float(U[i]))
        for c in n.get('children', []):
            rec(c)

    rec(ts['root'])
    grid = {k: float(np.median(v)) for k, v in cells.items() if len(v) >= 3}
    keys = np.array(sorted(grid.keys()), dtype=np.float64)
    return grid, keys, cKDTree((keys + 0.5) * CELL)


def deform(src, dst, lift, grid, keys, tree):
    js, bn = read_chunks(src)
    seen, tot, hit = set(), 0, 0
    for mesh in js['meshes']:
        for pr in mesh['primitives']:
            ai = pr['attributes']['POSITION']
            if ai in seen:
                continue
            seen.add(ai)
            pos, _ = get_pos(js, bn, ai)
            E = pos[:, 0].astype(np.float64)
            N = -pos[:, 2].astype(np.float64)
            d, ii = tree.query(np.stack([E, N], 1), k=1)
            ref = np.array([grid[tuple(keys[int(x)].astype(int))] for x in ii])
            mask = d <= R
            u_new = np.where(mask, ref + lift, pos[:, 1].astype(np.float64))
            pos[:, 1] = u_new.astype(np.float32)
            a = js['accessors'][ai]
            a['min'] = [a['min'][0], float(u_new.min()), a['min'][2]]
            a['max'] = [a['max'][0], float(u_new.max()), a['max'][2]]
            tot += len(pos)
            hit += int(mask.sum())
    write_glb(dst, js, bn)
    print('%s -> %s | verts %d, with-ref %d (%.0f%%), lift %.2f'
          % (src.name, dst.name, tot, hit, 100 * hit / tot, lift))
    return dst


def verify(dst, lift, grid, keys, tree):
    js, bn = read_chunks(dst)
    worst = 0.0
    n = 0
    for mesh in js['meshes']:
        for pr in mesh['primitives']:
            pos, _ = get_pos(js, bn, pr['attributes']['POSITION'])
            E = pos[:, 0].astype(np.float64)
            N = -pos[:, 2].astype(np.float64)
            d, ii = tree.query(np.stack([E, N], 1), k=1)
            for j in np.where(d <= R)[0]:
                ref = grid[tuple(keys[int(ii[j])].astype(int))]
                worst = max(worst, abs(float(pos[j, 1]) - (ref + lift)))
                n += 1
    print('  verify %s: samples %d, max |u-(ref+lift)| = %.2e m' % (dst.name, n, worst))


grid, keys, tree = build_grid()
print('ref grid cells %d' % len(keys))
r = deform(PORT / 'rebuilt/roads/roads.glb', OUT / 'roads-c.glb', 0.15, grid, keys, tree)
g = deform(PORT / 'rebuilt/ground/ground.glb', OUT / 'ground-c.glb', 0.05, grid, keys, tree)
verify(r, 0.15, grid, keys, tree)
verify(g, 0.05, grid, keys, tree)
