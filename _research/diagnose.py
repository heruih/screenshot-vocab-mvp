import pymupdf, re
from collections import Counter

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)

# 1) 词表区域内所有非 ASCII 字符的分布
char_counter = Counter()
for idx in range(20, 149):
    for ch in doc[idx].get_text():
        if ord(ch) > 127:
            char_counter[ch] += 1
print("=== 非ASCII字符分布 ===")
for ch, n in char_counter.most_common():
    print(f"  {repr(ch)}  U+{ord(ch):04X}  x{n}")

# 2) 定位 bank 的所有出现（页码 + 原始行）
print("\n=== 'bank' 出现位置 ===")
for idx in range(20, 149):
    for raw in doc[idx].get_text().split("\n"):
        if raw.strip().replace("　","") == "bank" or raw.strip().replace("　","") == "★bank":
            print(f"  P{idx+1}: {repr(raw)}")

# 3) 看词表中段一页（索引80）原始文本
print("\n=== 索引80 页原始文本前600 ===")
print(repr(doc[80].get_text()[:600]))
