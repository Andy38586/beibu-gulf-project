"""临时移除渲染器的 @ts-nocheck，跑一次 vue-tsc 统计真实错误数，然后原样还原。

安全保证：原文件内容先读入内存，try/finally 无条件写回；不触碰 git。
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    ROOT / "frontend/src/core/map/renderers/OLRenderer.ts",
    ROOT / "frontend/src/core/map/renderers/CesiumRenderer.ts",
]

backups = {}
try:
    for p in TARGETS:
        src = p.read_text(encoding="utf-8")
        backups[p] = src
        patched = re.sub(r"^// @ts-nocheck\s*$", "// (probe: ts-nocheck disabled)", src, count=1, flags=re.M)
        assert patched != src, f"未找到 @ts-nocheck: {p}"
        p.write_text(patched, encoding="utf-8", newline="")

    proc = subprocess.run(
        ["npx", "vue-tsc", "--noEmit", "-p", "frontend/tsconfig.app.json"],
        cwd=ROOT, capture_output=True, text=True, shell=True,
    )
    out = proc.stdout + proc.stderr
    errs = re.findall(r"^(.+?)\((\d+),(\d+)\): error (TS\d+)", out, flags=re.M)
    print(f"总错误数: {len(errs)}")
    per_file = {}
    codes = {}
    for f, _l, _c, code in errs:
        key = f.replace("\\", "/").split("frontend/src/")[-1]
        per_file[key] = per_file.get(key, 0) + 1
        codes[code] = codes.get(code, 0) + 1
    print("\n按文件:")
    for k, v in sorted(per_file.items(), key=lambda x: -x[1])[:10]:
        print(f"  {v:4d}  {k}")
    print("\n按错误码 TOP6:")
    for k, v in sorted(codes.items(), key=lambda x: -x[1])[:6]:
        print(f"  {v:4d}  {k}")
finally:
    for p, src in backups.items():
        p.write_text(src, encoding="utf-8", newline="")
    print("\n[已还原全部源文件]", file=sys.stderr)
