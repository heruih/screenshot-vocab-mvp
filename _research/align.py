import pymupdf, re, json

base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"

# ---- 1. 官方词形（含★级别、数字上标）----
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
official = []  # (word, level)
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

# ---- 2. 归一化函数 ----
def norm(w):
    w = w.lower().replace("ｇ", "g")
    # 全角连字符 U+FF27 转普通连字符
    w = w.replace("Ｇ", "-")
    # 去掉数字上标
    w = re.sub(r"[0-9]+$", "", w)
    # 斜杠/括号变体：取第一个主拼写
    w = w.split("/")[0]
    w = re.sub(r"\(.*?\)", "", w)
    return w.strip()

off_map = {}
for w, l in official:
    n = norm(w)
    if n and n not in off_map:
        off_map[n] = l

# ---- 3. ECDICT anchor ----
anchor = json.load(open(base + r"\cet46-anchor.json", encoding="utf-8"))
ec_map = {}
for e in anchor:
    n = norm(e["word"])
    lvl = 6 if "cet6" in e["tag"] else 4
    if n and n not in ec_map:
        ec_map[n] = lvl

print("官方归一后 unique 词形:", len(off_map))
print("ECDICT cet 归一后 unique:", len(ec_map))

inter = set(off_map) & set(ec_map)
only_off = sorted(set(off_map) - set(ec_map))
only_ec = sorted(set(ec_map) - set(off_map))
print("\n两者交集:", len(inter))
print("官方有、ECDICT未标cet:", len(only_off))
print("ECDICT标cet、官方无:", len(only_ec))

print("\n=== 官方有 ECDICT 未标（前40）===")
for w in only_off[:40]: print("  ", w, "级别", off_map[w])
print("\n=== ECDICT 有 官方无（前40）===")
for w in only_ec[:40]: print("  ", w)
