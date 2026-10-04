# -*- coding: utf-8 -*-
"""probe-terrain-tree-vs-layerjson.py — 只读：地形树完整性（layer.json 的 available 声明 vs 盘上实物）。

为什么：2026-09-10 线上事故是「layer.json 声明了 z0 两张根瓦片与 1/3/1，但盘上缺这三张」
⇒ Cesium 根四叉树建不起来、影像底图被整体拖黑（修法=08-backfill-root-tiles.py 幂等补齐）。

口径（2026-10-04 运行时实测更正，旧版此处的 TMS 说法是错的）：
  `available` 与 `scheme` **同向解析**——本层声明 `scheme: "slippyMap"`（y=0 在北），
  Cesium 1.142 就**按声明原样**请求/判可用（不做任何翻 y）。实测（真 Edge，:5174）：
  · 请求 `3/12/4.terrain`（= 声明的 y）⇒ **404**；请求 `3/12/3.terrain`（盘上实物）⇒ **200**；
  · z2 同款：声明 `2/6/2` ⇒ 404，盘上 `2/6/1` ⇒ 200；camera 3 km 下 z0/z1 全 200、z2/z3 全 404。
  旧 07/07c 把 available 按 `rows-1-y` 翻转写（对标 TMS），**与盘上 slippy 文件名互为镜像**
  ⇒ z≥2 的每一张声明瓦片都会被请求到镜像位置 404，Cesium 回退父层 ⇒ 地形实际只剩 z0/z1 精度。

判据：① 声明（直接口径）在盘上缺失、且"翻 y 后大量命中盘上"⇒ **镜像缺陷，红**（exit 1）；
② 根链（z ≤ 2）直接缺失 ⇒ 红（事故形态）；③ 孤儿（盘上有、声明无）⇒ 红；
④ 更深的少量"声明多、实物少"（z ≥ 3，且非镜像形态）只报 ⚠ 记账不判红。

用法（venv，仅标准库）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 tools/diag/probe-terrain-tree-vs-layerjson.py
前置：backend/static/terrain/ 在盘（.gitignore 排除；缺件时退出码 2，不算通过也不判红）。

修法（待用户点头后执行，先备份 layer.json）：用**盘上实清单**重建 available（**不翻 y**）——
改好的 `tools/dem-pipeline/07c-patch-terrain.py --dry-run` 会先打印「朝向自检」：
声明∩盘上 = N/N ｜ 镜像∩盘上 ≈ 0。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TERRAIN = ROOT / 'backend/static/terrain'
ROOT_SHALLOW = 2  # 事故形态只看根链（z0..z2）


def main() -> int:
    lj_path = TERRAIN / 'layer.json'
    if not lj_path.exists():
        print('缺输入：%s（.gitignore 排除目录，未取证）' % lj_path)
        return 2
    lj = json.loads(lj_path.read_text(encoding='utf-8'))
    declared = {}
    for z, ranges in enumerate(lj.get('available') or []):
        for r in ranges:
            for x in range(r['startX'], r['endX'] + 1):
                for y in range(r['startY'], r['endY'] + 1):
                    declared.setdefault(z, set()).add((x, y))
    present = set()
    for p in TERRAIN.rglob('*.terrain'):
        parts = p.relative_to(TERRAIN).parts
        if len(parts) == 3:
            present.add((int(parts[0]), int(parts[1]), int(parts[2][: -len('.terrain')])))
    decl_all = {(z, x, y) for z, s in declared.items() for (x, y) in s}
    # 镜像口径：旧脚本按 TMS 翻 y 写的形态（用来诊断"声明与实物互为镜像"这一根因）
    mirrored = {(z, x, 2**z - 1 - y) for (z, x, y) in decl_all}
    missing = decl_all - present
    orphan = present - decl_all
    missing_shallow = sorted(t for t in missing if t[0] <= ROOT_SHALLOW)
    missing_deep = sorted(t for t in missing if t[0] > ROOT_SHALLOW)
    direct_hits = len(decl_all & present)
    mirror_hits = len(mirrored & present)
    print('layer.json：version %s / maxzoom %s / scheme %s ｜ 声明 %d 张（直接口径，不翻 y）'
          % (lj.get('version'), lj.get('maxzoom'), lj.get('scheme'), len(decl_all)))
    print('  声明∩盘上 %d/%d ｜ 镜像(翻 y)∩盘上 %d —— 镜像远多于直接命中即为"声明与实物镜像"'
          % (direct_hits, len(decl_all), mirror_hits))
    print('盘上 *.terrain：%d 张 ｜ 根链(z≤%d)缺 %d ｜ 深层(z>%d)声明多于实物 %d ｜ 孤儿（有实物无声明）%d'
          % (len(present), ROOT_SHALLOW, len(missing_shallow), ROOT_SHALLOW, len(missing_deep), len(orphan)))
    by_level = {}
    for z, _x, _y in missing_deep:
        by_level[z] = by_level.get(z, 0) + 1
    if by_level:
        print('  深层漂移分布：' + ' ｜ '.join('z%d %d 张' % (z, n) for z, n in sorted(by_level.items())))
    fail = False
    if len(decl_all) > 0 and mirror_hits > direct_hits and direct_hits < len(decl_all):
        print('❌ 镜像声明（根因）：available 按 TMS 翻 y 写、盘上文件名按 slippy（y 从北）——'
              'Cesium 按声明原样请求 ⇒ 声明位置 404、回退父层（运行时实测 3/12/4⇒404、3/12/3⇒200）')
        print('   ⇒ 修法：用盘上实清单重建 available（不翻 y）；改好的 07c --dry-run 会打印朝向自检')
        fail = True
    if missing_shallow:
        print('❌ 根链缺失（前 20）：' + ', '.join('%d/%d/%d' % t for t in missing_shallow[:20]))
        print('   ⇒ 事故形态：Cesium 根四叉树可能建不起来；补法 = tools/dem-pipeline/08-backfill-root-tiles.py（幂等）')
        fail = True
    if orphan:
        print('❌ 孤儿瓦片（前 20，Cesium 不会请求到）：' + ', '.join('%d/%d/%d' % t for t in sorted(orphan)[:20]))
        fail = True
    if fail:
        return 1
    if missing_deep:
        print('⚠ 深层声明漂移：不影响渲染（回退父层），但会带来 404 请求；'
              '修法 = 重跑修好的 07c（用实写集重建 available）或按盘上清单重写 layer.json')
        return 0
    print('⇒ 声明与实物逐张一致，事故形态不存在')
    return 0


if __name__ == '__main__':
    sys.exit(main())
