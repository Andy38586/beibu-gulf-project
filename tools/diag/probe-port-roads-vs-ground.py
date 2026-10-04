# -*- coding: utf-8 -*-
"""probe-port-roads-vs-ground.py — 只读：港区道路层 vs 交付包地面的残余高差 + u₀ 三选项量化。

为什么（§8.12/§8.20）：道路层绕序修好后已可见，但它是一条**绝对水平板**
（u = groundLevel() + 0.15 m），而交付场地本身起伏 ⇒ 用户报的「路不平、有缝隙」还压在
"竖直基准 u₀ 取哪一档"上，两条候选口径差 ~2 m；另有一档是改成逐顶点跟随。本探针把
三档的 Δ 分布先算出来，供一行裁定。**只读**，不改盘上任何文件。

口径：交付包与自建层同一 ENU 系（§8.12 `root.transform`）；地面 = 交付包
rail/concrete/opaque/water 顶点按 4 m 格取中位（每格 ≥3 点）；Δ(顶点) =
道路 u − 顶点 3×3 邻域格中位。

用法（venv，需 numpy）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 \
    tools/diag/probe-port-roads-vs-ground.py
退出码：0 正常；2 缺交付包或自建道路层（两者都在 .gitignore 排除目录，需先重建：
交付包 tiles/ 为外部交付；道路层 `node tools/3dtiles-build/build-roads.mjs`）。
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
PORT = REPO / 'backend/static/qinzhou-port'
TILESET = PORT / 'tiles/tileset.json'
ROADS_TILESET = PORT / 'rebuilt/roads/tileset.json'

GROUND_MATS = ('rail', 'concrete', 'opaque', 'water')
LAND_MATS = ('rail', 'concrete', 'opaque')  # 陆域地面（水拿掉：码头边水面会像"立面"拉低参考）
CELL = 4.0  # 格子边长（米）
MAX_SAMPLE = 40000  # Δ 统计的道路顶点采样上限

CS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


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


def enu_from_gltf(pos):
    """glTF (x,y,z) → ENU (E,N,U) = (x, -z, y)：与 tools/3dtiles-build/glb.mjs 同款"""
    E = pos[:, 0].astype(np.float64)
    N = -pos[:, 2].astype(np.float64)
    U = pos[:, 1].astype(np.float64)
    return E, N, U


def walk_tiles(tileset_path, want):
    """按瓦片收集各材质 ENU 顶点。want=None 表示全收。返回 {uri: {material: (N,3)}}。"""
    d = Path(tileset_path).parent
    ts = json.load(open(tileset_path, encoding='utf-8'))
    out = {}

    def rec(node):
        uri = (node.get('content') or {}).get('uri') or ''
        if uri:
            p = d / uri
            if p.exists():
                j, b = read_glb(p)
                mats = j.get('materials') or [{}]
                per_mat = out.setdefault(uri, {})
                for mesh in j['meshes']:
                    for pr in mesh['primitives']:
                        mi = pr.get('material')
                        name = mats[mi].get('name', '?') if mi is not None else '?'
                        if want and name not in want:
                            continue
                        pos = acc(j, b, pr['attributes']['POSITION'])
                        E, N, U = enu_from_gltf(pos)
                        per_mat.setdefault(name, []).append(np.stack([E, N, U], 1))
        for c in node.get('children', []):
            rec(c)

    rec(ts['root'])
    return {
        uri: {m: np.concatenate(v) for m, v in mats.items()}
        for uri, mats in out.items()
        if mats
    }


def grid_medians(G):
    key = np.floor(G[:, :2] / CELL).astype(np.int64)
    h = {}
    for i in range(len(G)):
        h.setdefault((key[i, 0], key[i, 1]), []).append(G[i, 2])
    return {k: float(np.median(v)) for k, v in h.items() if len(v) >= 3}


def neighborhood(cell_u, E, N):
    """3×3 邻域格中位；无格返回 None。"""
    k = (int(np.floor(E / CELL)), int(np.floor(N / CELL)))
    vals = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            v = cell_u.get((k[0] + dx, k[1] + dy))
            if v is not None:
                vals.append(v)
    return float(np.median(vals)) if vals else None


def pct(x, q):
    return float(np.percentile(x, q)) if len(x) else float('nan')


def dist_line(label, D):
    D = D[~np.isnan(D)]
    if not len(D):
        print('  %-22s （无有效点）' % label)
        return
    shares = ' ｜ '.join(
        '|Δ|>%.1f %.1f%%' % (t, float(np.mean(np.abs(D) > t)) * 100) for t in (0.5, 1, 2, 3)
    )
    print(
        '  %-24s 中位 %+.2f ｜ MAD %.2f ｜ P5/P25/P75/P95 = %+.2f/%+.2f/%+.2f/%+.2f ｜ %s ｜ 埋 %.0f%%'
        % (label, float(np.median(D)), float(np.median(np.abs(D - np.median(D)))),
           pct(D, 5), pct(D, 25), pct(D, 75), pct(D, 95), shares,
           float(np.mean(D < -0.05)) * 100)
    )


def main():
    for p in (TILESET, ROADS_TILESET):
        if not p.exists():
            print('缺输入：%s（在 .gitignore 排除目录，需先重建/取回交付包）' % p)
            return 2

    ground = walk_tiles(TILESET, GROUND_MATS)
    G = np.concatenate([a for m in ground.values() for a in m.values()])
    G_land = np.concatenate(
        [a for m in ground.values() for mat, a in m.items() if mat in LAND_MATS]
    )
    grids = {'全材质': grid_medians(G), '陆域(去水)': grid_medians(G_land)}
    files = sorted((PORT / 'tiles').glob('t[45]_*.glb'))
    print('交付包地面顶点 %d（tileset 瓦片 %d 块，其中 t4/t5 细瓦片 %d 块；材质 %s）'
          % (len(G), len(ground), len(files), ','.join(sorted({m for a in ground.values() for m in a}))))
    print('格子 %g m：%d 格（每格 ≥3 点）｜覆盖 ENU 范围 E %.0f..%.0f / N %.0f..%.0f'
          % (CELL, len(grids['全材质']), G[:, 0].min(), G[:, 0].max(), G[:, 1].min(), G[:, 1].max()))

    roads = walk_tiles(ROADS_TILESET, None)
    R = np.concatenate([a for m in roads.values() for a in m.values()])
    u_roads = float(np.median(R[:, 2]))
    print('道路层顶点 %d（%d 块瓦片）｜u 分布 %+.2f / %+.2f / %+.2f（P5/中位/P95）'
          % (len(R), len(roads), pct(R[:, 2], 5), u_roads, pct(R[:, 2], 95)))
    print('道路网 ENU bbox：E %.0f..%.0f / N %.0f..%.0f'
          % (R[:, 0].min(), R[:, 0].max(), R[:, 1].min(), R[:, 1].max()))

    # —— u₀ 选项 A：现状 = groundLevel() 口径（t4/t5 全 pool 的 rail/concrete 中位均值）
    pool = {}
    for uri in sorted(ground):
        if Path(uri).name.startswith(('t4_', 't5_')):
            for m in ('rail', 'concrete'):
                if m in ground[uri]:
                    pool.setdefault(m, []).append(ground[uri][m][:, 2])
    meds = {m: float(np.median(np.concatenate(v))) for m, v in pool.items() if v}
    u_a = float(np.mean([meds[m] for m in ('rail', 'concrete') if m in meds]))
    print('u₀ 口径 A（t4/t5 全 pool）：rail %+.2f / concrete %+.2f ⇒ u₀ = %+.3f（现役道路 u %+.2f = u₀+0.15）'
          % (meds.get('rail', float('nan')), meds.get('concrete', float('nan')), u_a, u_roads))

    # —— 道路顶点采样 + 邻域地面（两组地面池对照）
    step = max(1, len(R) // MAX_SAMPLE)
    S = R[::step]
    samples = {}
    for gname, grid in grids.items():
        gv = np.full(len(S), np.nan)
        for i, (E, N, _U) in enumerate(S):
            g = neighborhood(grid, E, N)
            if g is not None:
                gv[i] = g
        samples[gname] = gv
        miss = int(np.isnan(gv).sum())
        print('道路采样 %d 点（%d 分之一）｜池=%s：有邻域地面 %d｜无格 %d（%.1f%%）'
              % (len(S), step, gname, len(S) - miss, miss, miss / len(S) * 100))

    # —— u₀ 选项 B1：只算"与道路网 bbox 相交的 t4/t5 瓦片"（§8.12 待收紧口径的候选）
    x0, y0 = R[:, 0].min() - CELL, R[:, 1].min() - CELL
    x1, y1 = R[:, 0].max() + CELL, R[:, 1].max() + CELL
    b1 = {}
    hit_tiles = []
    for uri in sorted(ground):
        if not Path(uri).name.startswith(('t4_', 't5_')):
            continue
        hit = False
        for m in ('rail', 'concrete'):
            a = ground[uri].get(m)
            if a is None:
                continue
            inm = (a[:, 0] >= x0) & (a[:, 0] <= x1) & (a[:, 1] >= y0) & (a[:, 1] <= y1)
            if inm.any():
                hit = True
                b1.setdefault(m, []).append(a[inm, 2])
        if hit:
            hit_tiles.append(Path(uri).name)
    b1m = {m: float(np.median(np.concatenate(v))) for m, v in b1.items() if v}
    u_b1 = float(np.mean([b1m[m] for m in ('rail', 'concrete') if m in b1m])) if b1m else float('nan')
    print('u₀ 口径 B1（t4/t5 中与道路 bbox 相交者，%d 块：%s）：rail %+.2f / concrete %+.2f ⇒ u₀ = %+.3f'
          % (len(hit_tiles), ','.join(hit_tiles), b1m.get('rail', float('nan')),
             b1m.get('concrete', float('nan')), u_b1))

    # —— u₀ 选项 B2：单常数-道路加权（把整板抬到"中位道路恰好高于邻域地面 15 cm"）
    for gname in grids:
        print('u₀ 口径 B2（道路邻域地面中位，池=%s）⇒ u₀ = %+.3f'
              % (gname, float(np.nanmedian(samples[gname]))))

    # —— 作业区窗口：近端细瓦片簇（=1.5 km 档实际载入的 d4/d5 块）并集 bbox
    ops_pts = [a for uri in hit_tiles for a in ground[uri].values()]
    ops = np.concatenate(ops_pts)
    ox0, oy0, ox1, oy1 = ops[:, 0].min(), ops[:, 1].min(), ops[:, 0].max(), ops[:, 1].max()
    inside = (
        (S[:, 0] >= ox0) & (S[:, 0] <= ox1) & (S[:, 1] >= oy0) & (S[:, 1] <= oy1)
    )
    print('作业区窗口（近端细瓦片并集）E %.0f..%.0f / N %.0f..%.0f：道路采样落内 %d/%d（%.0f%%）'
          % (ox0, ox1, oy0, oy1, int(inside.sum()), len(S), inside.mean() * 100))

    # —— Δ 三档
    print('\n道路−地面 高差 Δ（m，逐顶点，3×3 格中位；负=路埋在场地面之下）：')
    for gname in grids:
        gv = samples[gname]
        print('  地面池 = %s（无格 %d 点，占 %.1f%%）'
              % (gname, int(np.isnan(gv).sum()), np.isnan(gv).mean() * 100))
        dist_line('A 现状 u₀=%+.2f（全网）' % u_a, u_roads - gv)
        dist_line('A 现状（作业区窗口内）', (u_roads - gv)[inside])
        dist_line('B1 单常数（bbox 瓦片，全网）', (u_b1 + 0.15) - gv)
        dist_line('B1 单常数（作业区窗口内）', ((u_b1 + 0.15) - gv)[inside])
        dist_line('B2 单常数（道路邻域）', (float(np.nanmedian(gv)) + 0.15) - gv)
        dist_line('B2 单常数（作业区窗口内）', ((float(np.nanmedian(gv)) + 0.15) - gv)[inside])
    print('  %-24s 逐顶点跟随 ⇒ Δ 恒 = +0.15（无格点除外；无格点需更大半径回退）'
          % ('C 逐顶点跟随'))

    # —— C 的回退半径评估：每个道路采样点到最近地面格中心的距离。
    #    语义：C 只对"找得到参考"的顶点有效；无参考点必须选回退半径与越界策略。
    try:
        from scipy.spatial import cKDTree
        have_kd = True
    except ImportError:
        have_kd = False
    if have_kd:
        print('\nC 回退半径评估（道路采样点 → 最近地面格中心的距离）：')
        for gname in grids:
            grid = grids[gname]
            keys = np.array(sorted(grid.keys()), dtype=np.float64)
            centers = (keys + 0.5) * CELL
            tree = cKDTree(centers)
            tree_self = tree.query(centers, k=1)[0]
            dmin, imin = tree.query(S[:, :2], k=1)
            nn_u = np.array([grid[(int(k[0]), int(k[1]))] for k in keys])[imin]
            print('  池 = %s ｜ 自检：格中心回喂距离 max=%.6f m（期望 0）'
                  % (gname, float(tree_self.max())))
            print('    距离分位 P50/P75/P90/P95/P99 = %.1f/%.1f/%.1f/%.1f/%.1f m'
                  % tuple(float(np.percentile(dmin, q)) for q in (50, 75, 90, 95, 99)))
            prev = np.zeros(len(dmin), dtype=bool)
            for R in (4, 8, 12, 16, 24, 32, 48, 64, 128, 256):
                cov = dmin <= R
                new = cov & ~prev
                med_new = float(np.median(u_roads - nn_u[new])) if new.any() else float('nan')
                cov_in = float((dmin[inside] <= R).mean() * 100) if inside.any() else float('nan')
                print('    R≤%3d m：全网覆盖 %5.1f%%（+%d 点）｜ 窗口内覆盖 %5.1f%% ｜ '
                      '本档新增点现状Δ(u路−u格)中位 %+.2f m'
                      % (R, cov.mean() * 100, int(new.sum()), cov_in, med_new))
                prev = cov
            edges = (4, 8, 16, 32, 64, 128, 256, 10**9)
            for a, b in zip((0,) + edges[:-1], edges):
                m = (dmin >= a) & (dmin < b)
                if not m.any():
                    continue
                med = float(np.median(u_roads - nn_u[m]))
                print('    距离 [%g,%g)：%d 点（%.1f%%）｜ 窗口内 %d 点 ｜ 现状Δ中位 %+.2f m'
                      % (a, b, int(m.sum()), m.mean() * 100, int((m & inside).sum()), med))
        print('  口径：C 的实施 = u 路顶点 := u(最近地面格) + 0.15；上表回答"回退半径取多大时'
              '剩余无参考点可忽略、且不跨场地拉错参考"。')
    else:
        print('\nC 回退半径评估：缺 scipy ⇒ SKIPPED（不判红也不判绿）')

    # —— C 的连带影响面：ground 层（build-ground 常数面 u=groundU+0.05）是否需同笔跟随。
    #    语义：C 让道路逐顶点抬到"真实地面 +0.15"；若 ground 层仍是常数平面，两者会拉开。
    ground_glb = PORT / 'rebuilt/ground/ground.glb'
    if ground_glb.exists() and have_kd:
        jg, bg = read_glb(ground_glb)
        parts = []
        for mesh in jg['meshes']:
            for pr in mesh['primitives']:
                pos = acc(jg, bg, pr['attributes']['POSITION'])
                E, N, U = enu_from_gltf(pos)
                parts.append(np.stack([E, N, U], 1))
        Gg = np.concatenate(parts)
        ug = float(np.median(Gg[:, 2]))
        print('\nC 连带影响面：ground 层 %d 顶点｜u 中位 %+.2f（P5/P95 %+.2f/%+.2f）｜'
              'bbox E %.0f..%.0f / N %.0f..%.0f'
              % (len(Gg), ug, pct(Gg[:, 2], 5), pct(Gg[:, 2], 95),
                 Gg[:, 0].min(), Gg[:, 0].max(), Gg[:, 1].min(), Gg[:, 1].max()))
        gin = ((S[:, 0] >= Gg[:, 0].min()) & (S[:, 0] <= Gg[:, 0].max())
               & (S[:, 1] >= Gg[:, 1].min()) & (S[:, 1] <= Gg[:, 1].max()))
        print('  ground bbox 内道路采样 %d/%d（%.0f%%）'
              % (int(gin.sum()), len(S), gin.mean() * 100))
        if gin.any():
            grid = grids['全材质']
            keys = np.array(sorted(grid.keys()), dtype=np.float64)
            tree2 = cKDTree((keys + 0.5) * CELL)
            d2, i2 = tree2.query(S[gin][:, :2], k=1)
            nn2 = np.array([grid[(int(k[0]), int(k[1]))] for k in keys])[i2]
            print('    道路侧 R≤24 m 有参考 %d/%d（%.0f%%）；无参考回退现状 %d 点'
                  % (int((d2 <= 24.0).sum()), int(gin.sum()), float((d2 <= 24.0).mean()) * 100,
                     int((d2 > 24.0).sum())))
            dg, _ig = tree2.query(Gg[:, :2], k=1)
            print('    ground 顶点自身最近格距离 P50/P90/P99 = %.1f/%.1f/%.1f m；R≤24 m 覆盖 %.0f%%'
                  % (float(np.percentile(dg, 50)), float(np.percentile(dg, 90)),
                     float(np.percentile(dg, 99)), float((dg <= 24.0).mean()) * 100))
            u_c = np.where(d2 <= 24.0, nn2 + 0.15, u_roads)
            dist_line('C 前：路(常数) − ground 层', np.full(int(gin.sum()), u_roads - ug))
            dist_line('C 后：路(逐顶点) − ground 层', u_c - ug)
            print('    C 后高出 ground 层 >0.5 m 的点占 %.0f%%（C 前 %.0f%%）⇒ 若 ground 层不同步'
                  '逐顶点，路面会浮在它上方'
                  % (float(np.mean((u_c - ug) > 0.5)) * 100, float(np.mean((u_roads - ug) > 0.5)) * 100))

    # —— 每块细瓦片：地面材质中位（判断 u₀ 口径分歧来源）
    print('\nt4/t5 逐块（rail/concrete 中位 u；是否与道路 bbox 相交）：')
    for f in files:
        uri = f.name
        per = ground.get(uri, {})
        bits = []
        inner = []
        span = ''
        for m in ('rail', 'concrete'):
            a = per.get(m)
            if a is not None:
                bits.append('%s %+.2f(n=%d)' % (m, float(np.median(a[:, 2])), len(a)))
                inm = (a[:, 0] >= x0) & (a[:, 0] <= x1) & (a[:, 1] >= y0) & (a[:, 1] <= y1)
                if inm.any():
                    inner.append(m)
        all_pts = list(per.values())
        if all_pts:
            P = np.concatenate(all_pts)
            span = ' E %.0f..%.0f/N %.0f..%.0f' % (P[:, 0].min(), P[:, 0].max(), P[:, 1].min(), P[:, 1].max())
        mark = '  ←道路网' if inner else ''
        print('  %-15s %s%s%s' % (uri, '；'.join(bits) or '（无 rail/concrete）', span, mark))

    print('\n结论口径：A=现状；B1/B2=单常数两候选；C=逐顶点跟随。三档取舍属改 §8.12 权威源，须用户裁定。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
