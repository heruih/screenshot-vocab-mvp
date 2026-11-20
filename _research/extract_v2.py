import pymupdf, re, json

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)

entries = []   # [word, level]
multi_lines = []

for idx in range(20, 149):
    for raw in doc[idx].get_text().split("\n"):
        s = raw.strip().replace("　", "").strip()
        if not s: continue
        if "全国大学英语" in s or "词表" in s: continue
        # 单个数字上标（全角/半角），合并到上一个词
        if re.fullmatch(r"[0-9０-９]", s):
            if entries:
                digit = str(int(s))  # 归一为半角
                entries[-1][0] = entries[-1][0] + digit
            continue
        if re.fullmatch(r"[0-9０-９]+", s):  # 页码等
            continue
        level = 4
        if s.startswith("★"):
            level = 6
            s = s[1:].strip()
        if " " in s:
            multi_lines.append((s, level))
        entries.append([s, level])

print("合并数字上标后总词目:", len(entries), " 目标 5418")
lvl6 = [e for e in entries if e[1] == 6]
print("带★词目数:", len(lvl6))
print("含空格的多词行:", len(multi_lines))
for m in multi_lines: print("  ", m)

# 检查重复
wlist = [e[0] for e in entries]
dups = sorted({w for w in wlist if wlist.count(w) > 1})
print("\n仍重复的词目:", dups)

# 数字上标词清单
numbered = sorted({e[0] for e in entries if re.search(r"[0-9]$", e[0])})
print("\n带数字上标的词目数:", len(numbered))
print(numbered)
