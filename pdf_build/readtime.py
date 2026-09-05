# -*- coding: utf-8 -*-
import re, pathlib
t = pathlib.Path(r"C:\Users\JionHappY\Desktop\面试总集-数据卷-完整合订版（含思维链与名词全解）.md").read_text(encoding="utf-8")

fence = re.compile(r"```[^\n]*\n(.*?)```", re.S)
codes = fence.findall(t)
code_lines = sum(c.count("\n") for c in codes)
no_code = fence.sub("", t)

cn = len(re.findall(r"[一-鿿]", no_code))
en_words = len(re.findall(r"[A-Za-z]+", no_code))
table_rows = len(re.findall(r"^\|", no_code, flags=re.M))
print("中文字数:", cn, "| 英文词:", en_words, "| 代码段:", len(codes), "代码行:", code_lines, "| 表格行:", table_rows)

# 技术备考材料：精读需理解+记忆，速度低于休闲阅读。分三档等效字符量
equiv = cn + en_words*1.6 + code_lines*45 + table_rows*28
print("等效阅读量约:", int(equiv), "字符")
for name, speed in [("精读理解(250字/分)", 250), ("正常备考速度(350字/分)", 350), ("快速过(550字/分)", 550)]:
    m = equiv/speed
    print(f"  {name}: {m:.0f} 分钟 ≈ {m/60:.1f} 小时")

# 分部分统计（按 H1 切分）
parts = re.split(r"\n# ", t)
print("\n各章中文字数:")
for p in parts[1:]:
    title = p.splitlines()[0][:24]
    c = len(re.findall(r"[一-鿿]", p))
    print(f"  {c:6d}  {title}")
