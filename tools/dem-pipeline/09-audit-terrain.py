# -*- coding: utf-8 -*-
"""
09-audit-terrain.py
校验 heightmap 地形目录与 layer.json 的一致性（部署前/排障用）：
  - layer.json.available 恒为 TMS 朝向（y=0 在南），磁盘文件按 slippyMap（y=0 在北），
    GeographicTilingScheme 下 rows=2^z，换算 y_slippy = rows-1-y_tms；
  - 检查"声明了但磁盘缺失"（线上 404 黑屏的直接原因）与"磁盘有但未声明"两类问题；
  - 每张瓦片回读校验字节长度 = 65*65*2+2。
用法：python 09-audit-terrain.py [terrain_dir]
退出码：0 全部一致；1 存在不一致。
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

GRID = 65
EXPECTED_RAW = GRID * GRID * 2 + 2


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("backend/static/terrain")
    meta = json.loads((root / "layer.json").read_text(encoding="utf-8"))
    available = meta["available"]

    declared: set[tuple[int, int, int]] = set()
    for z, ranges in enumerate(available):
        rows = 2**z
        for rng in ranges:
            for x in range(rng["startX"], rng["endX"] + 1):
                for y_tms in range(rng["startY"], rng["endY"] + 1):
                    y_slippy = rows - 1 - y_tms
                    declared.add((z, x, y_slippy))

    on_disk: set[tuple[int, int, int]] = set()
    bad_bytes: list[str] = []
    for p in root.rglob("*.terrain"):
        rel = p.relative_to(root).parts
        z, x, yfile = int(rel[0]), int(rel[1]), rel[2]
        y = int(yfile.split(".")[0])
        on_disk.add((z, x, y))
        try:
            if len(gzip.decompress(p.read_bytes())) != EXPECTED_RAW:
                bad_bytes.append(str(p.relative_to(root)))
        except Exception as exc:  # noqa: BLE001
            bad_bytes.append(f"{p.relative_to(root)} (解压失败 {exc})")

    missing = sorted(declared - on_disk)
    extra = sorted(on_disk - declared)

    print(f"layer.json 声明瓦片 {len(declared)} 张；磁盘实际 {len(on_disk)} 张")
    if missing:
        print(f"\n[缺失] 声明存在但磁盘没有（{len(missing)}）——这些 URL 线上会 404：")
        for t in missing[:50]:
            print("  ", f"{t[0]}/{t[1]}/{t[2]}.terrain")
        if len(missing) > 50:
            print("   ... 其余", len(missing) - 50, "张")
    if extra:
        print(f"\n[多余] 磁盘有但 layer.json 未声明（{len(extra)}）——不会被请求，属冗余：")
        for t in extra[:50]:
            print("  ", f"{t[0]}/{t[1]}/{t[2]}.terrain")
    if bad_bytes:
        print(f"\n[损坏] 字节长度/解压异常（{len(bad_bytes)}）：")
        for b in bad_bytes[:50]:
            print("  ", b)

    ok = not missing and not extra and not bad_bytes
    print("\n结果：", "PASS ✅ 声明与磁盘完全一致" if ok else "FAIL ❌ 见上")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
