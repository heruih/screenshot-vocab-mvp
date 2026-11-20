import pymupdf, re, json, csv

base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"

# 官方词（保留原始词形 + 级别）
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
official = []
for idx in range(20, 149):
    for raw in doc[idx].get_text().split("\n"):
        s = raw.strip().replace("　", "").strip()
        if not s: continue
        if "全国大学英语" in s or "词表" in s or s in ("词", "表"): continue
        if re.fullmatch(r"[0-9０-９]", s):
            if official: official[-1][0] += str(int(s))
            continue
        if re.fullmatch(r"[0-9０-９]+", s): continue
        lvl = 6 if s.startswith("★") else 4
        if s.startswith("★"): s = s[1:]
        official.append([s, lvl])

# ECDICT 全量映射（小写）
ec = {}
with open(base + r"\ecdict.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        ec[row["word"].lower()] = row

def variants(w):
    """生成候选拼写"""
    w0 = w.lower().replace("Ｇ", "-")
    cands = [w0]
    base_w = re.sub(r"[0-9]+$", "", w0)
    if base_w != w0: cands.append(base_w)
    main = base_w.split("/")[0]
    if main not in cands: cands.append(main)
    paren = re.sub(r"\(.*?\)", "", main)
    if paren not in cands: cands.append(paren)
    return [c for c in cands if c]

hit, miss = [], []
for w, lvl in official:
    found = None
    for c in variants(w):
        if c in ec:
            found = ec[c]; break
    if found:
        hit.append((w, lvl, found))
    else:
        miss.append((w, lvl))

print("官方词形总数:", len(official))
print("ECDICT 命中(取到音标/释义):", len(hit), f"({len(hit)/len(official)*100:.1f}%)")
print("未命中:", len(miss))
for w, l in miss[:50]:
    print("   ", repr(w), "级别", l)
