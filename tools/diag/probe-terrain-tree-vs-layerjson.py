# -*- coding: utf-8 -*-
"""probe-terrain-tree-vs-layerjson.py — 只读：地形树完整性（layer.json 的 available 声明 vs 盘上实物）。

为什么：2026-09-10 线上事故是「layer.json 声明了 z0 两张根瓦片与 1/3/1，但盘上缺这三张」
⇒ Cesium 根四叉树建不起来、影像底图被整体拖黑（修法=08-backfill-root-tiles.py 幂等补齐）。

口径（易踩）：`layer.json.available` **恒按 TMS 朝向**写（y 从南；见 07-heightmap-reslice.py:165-169
与 07c-patch-terrain.py:124 的 `rows-1-y` 翻转换算），而盘上文件名是 slippyMap（y 从北）。
比较前必须把 available 的 y 翻回来，否则会误报"几乎全缺"（第一版本探针即栽在这里）。

判据：① 根链（z ≤ 2）声明缺失 ⇒ 红（exit 1，事故形态）；② 盘上有、声明无（孤儿）⇒ 红；
③ 更深的"声明多、实物少"（z ≥ 3）只报 ⚠ 不判红——Cesium 会回退到父层，
但数量要记账（07c 的 `available` 建在 bbox 计划集而非实写集上即出这类漂移）。

用法（venv，仅标准库）：
  backend/algorithm-service/.venv/Scripts/python.exe -X utf8 tools/diag/probe-terrain-tree-vs-layerjson.py
前置：backend/static/terrain/ 在盘（.gitignore 排除；缺件时退出码 2，不算通过也不判红）。
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
        rows = 2**z
        for r in ranges:
            for x in range(r['startX'], r['endX'] + 1):
                for y in range(r['startY'], r['endY'] + 1):
                    # available 是 TMS 朝向；盘上文件名是 slippyMap ⇒ 翻 y
                    declared.setdefault(z, set()).add((x, rows - 1 - y))
    present = set()
    for p in TERRAIN.rglob('*.terrain'):
        parts = p.relative_to(TERRAIN).parts
        if len(parts) == 3:
            present.add((int(parts[0]), int(parts[1]), int(parts[2][: -len('.terrain')])))
    decl_all = {(z, x, y) for z, s in declared.items() for (x, y) in s}
    missing = decl_all - present
    orphan = present - decl_all
    missing_shallow = sorted(t for t in missing if t[0] <= ROOT_SHALLOW)
    missing_deep = sorted(t for t in missing if t[0] > ROOT_SHALLOW)
    print('layer.json：version %s / maxzoom %s ｜ 声明 %d 张（已按 TMS→slippy 翻 y 比较）'
          % (lj.get('version'), lj.get('maxzoom'), len(decl_all)))
    print('盘上 *.terrain：%d 张 ｜ 根链(z≤%d)缺 %d ｜ 深层(z>%d)声明多于实物 %d ｜ 孤儿（有实物无声明）%d'
          % (len(present), ROOT_SHALLOW, len(missing_shallow), ROOT_SHALLOW, len(missing_deep), len(orphan)))
    by_level = {}
    for z, _x, _y in missing_deep:
        by_level[z] = by_level.get(z, 0) + 1
    if by_level:
        print('  深层漂移分布：' + ' ｜ '.join('z%d %d 张' % (z, n) for z, n in sorted(by_level.items())))
    fail = False
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
