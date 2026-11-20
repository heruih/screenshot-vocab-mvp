import pymupdf, re
from collections import Counter

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)

# 正确合并数字上标，收集 entry
entries=[]
for idx in range(20,149):
    for raw in doc[idx].get_text().split("\n"):
        s=raw.strip().replace("　","").strip()
        if not s: continue
        if "全国大学英语" in s or "词表" in s or s in ("词","表"): continue
        if re.fullmatch(r"[0-9０-９]",s):
            if entries: entries[-1][0]+=str(int(s))
            continue
        if re.fullmatch(r"[0-9０-９]+",s): continue
        lvl=6 if s.startswith("★") else 4
        if s.startswith("★"): s=s[1:]
        entries.append([s,lvl])

print("总 entry:", len(entries))
# 全局去重
seen={}
for w,l in entries:
    if w not in seen: seen[w]=l
print("全局 unique 词目:", len(seen))

# 首字母分布（看是否有重复字母段）
initials=Counter(w[0].lower() for w in seen)
print("\n首字母分布:")
print(dict(sorted(initials.items())))

# 判断 P22(索引21) 是否双栏：看 words 的 x0 聚类
page=doc[21]
words=page.get_text("words")
x0s=sorted(set(round(w[0]) for w in words))
print("\nP22 不同 x0:", x0s)
print("P22 words 物理数:", len(words))
