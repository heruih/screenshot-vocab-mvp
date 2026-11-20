import pymupdf, re
from collections import Counter

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)

# 收集词表页所有“干净行”（与主脚本相同过滤），但保留原始用于诊断
rows = []
for idx in range(20, 149):
    for raw in doc[idx].get_text().split("\n"):
        line = raw.strip().replace("　", "").strip()
        if not line: continue
        if "全国大学英语" in line or "词表" in line: continue
        if re.fullmatch(r"[0-9０-９]+", line): continue
        rows.append(line)

print("总行数:", len(rows))
print("去重后 unique 行数:", len(set(rows)))

# bound 相关原始行（看数字上标怎么呈现）
print("\n=== 含 bound 的原始行（含未过滤）===")
seen=set()
for idx in range(20,149):
    for raw in doc[idx].get_text().split("\n"):
        s=raw.strip().replace("　","")
        if s.startswith("bound") or re.fullmatch(r"[0-9０-９]", s):
            key=(idx,s)
            if key not in seen and s.startswith("bound"):
                print(f"  P{idx+1}: {repr(raw.strip())}")
                seen.add(key)

# 多词行（含空格）数量
multi = [r for r in rows if " " in r]
print("\n含空格的行数:", len(multi))
for m in multi[:10]: print("  ", repr(m))

# P30 完整文本
print("\n=== P30 完整文本 ===")
print(doc[29].get_text())
