"""一次性核查脚本：统计代码注释中的审计编号（只读，不修改任何源文件）。"""
import os
import re
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKIP_DIRS = {"node_modules", "coverage", ".git", "dist", "public", ".venv", "lcov-report"}
EXTS = {".ts", ".js", ".vue", ".py", ".cjs", ".mjs"}

# 审计编号形态：@arch-note / P0-3 / P1-21 / D-7 / TS-1 / R-1 / z042 / c027 / d060
NUM = re.compile(
    r"(@arch-note|\bP[012]-\d+|\bD-\d{1,2}\b|\bTS-\d+\b|\bR-\d+\b|\b[a-z]0\d{2}\b|\bz\d{3}\b)"
)
COMMENT = re.compile(r"^\s*(//|/\*|\*|#|<!--)")

hits = Counter()
files = {}
kinds = Counter()

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        if os.path.splitext(fn)[1] not in EXTS:
            continue
        p = os.path.join(dirpath, fn)
        rel = os.path.relpath(p, ROOT).replace("\\", "/")
        if "__tests__" in rel or rel.endswith(".test.ts") or rel.endswith(".test.js"):
            zone = "test"
        else:
            zone = "src"
        try:
            lines = open(p, encoding="utf-8", errors="ignore").read().splitlines()
        except OSError:
            continue
        n = 0
        for ln in lines:
            if not COMMENT.match(ln):
                continue
            found = NUM.findall(ln)
            if found:
                n += len(found)
                for f in found:
                    kinds[f if f == "@arch-note" else re.sub(r"\d+", "#", f)] += 1
        if n:
            files[rel] = n
            hits[zone] += n

print("== 按区域 ==")
for k, v in hits.items():
    print(f"{k}: {v} 处")
print(f"\n涉及文件数: {len(files)}")
print(f"总计: {sum(files.values())} 处\n")
print("== 编号形态 TOP ==")
for k, v in kinds.most_common(12):
    print(f"{k:16s} {v}")
print("\n== 密度 TOP 15 文件 ==")
for rel, n in sorted(files.items(), key=lambda x: -x[1])[:15]:
    print(f"{n:5d}  {rel}")
