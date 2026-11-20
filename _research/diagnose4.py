import pymupdf, re

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)

# 1) 词表封面/说明页 索引19 完整文本
print("=== 索引19 (P20) 完整文本 ===")
print(doc[19].get_text())

# 2) 每页过滤后行数
def count_page(idx):
    n = 0
    for raw in doc[idx].get_text().split("\n"):
        s = raw.strip().replace("　","").strip()
        if not s: continue
        if "全国大学英语" in s or "词表" in s: continue
        if re.fullmatch(r"[0-9０-９]+", s): continue
        if s in ("词","表"): continue
        n += 1
    return n

counts = [(idx, count_page(idx)) for idx in range(20,149)]
total = sum(c for _,c in counts)
print("=== 各页行数(索引:行数) ===")
print(", ".join(f"{i+1}:{c}" for i,c in counts))
print("求和:", total)
print("最少页:", min(counts,key=lambda x:x[1]), " 最多页:", max(counts,key=lambda x:x[1]))
