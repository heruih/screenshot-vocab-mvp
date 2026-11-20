import pymupdf, re, json, csv, unicodedata, os

base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"

# ---------- 1. 鲁棒提取 ----------
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
raw_items = []
for idx in range(20, 149):
    lines = [l.strip().replace("　", "").strip() for l in doc[idx].get_text().split("\n")]
    lines = [l for l in lines if l]
    i = 0
    while i < len(lines):
        s = lines[i]
        if "全国大学英语" in s or "词表" in s or s in ("词", "表"):
            i += 1; continue
        nk = unicodedata.normalize("NFKC", s)
        if re.fullmatch(r"[0-9]+", nk):
            n = int(nk)
            if 1 <= n <= 3 and raw_items:   # 同形异义上标 1-3
                raw_items[-1] += str(n)
            # 多位数=页码，丢弃
            i += 1; continue
        if s.endswith("(") and i + 1 < len(lines):   # 跨行括号
            s = s + lines[i+1]; i += 1
        raw_items.append(s)
        i += 1

official = []
for s in raw_items:
    lvl = 6 if s.startswith("★") else 4
    if s.startswith("★"): s = s[1:]
    official.append([s, lvl])

# ---------- 2. 归一化 ----------
SPECIAL = {
    "accordingto":"according to","babyboomer":"baby boomer","oughtto":"ought to","owingto":"owing to",
    "microwavable":"microwaveable","honourary":"honorary","coupd'etat":"coup d'etat",
}
def strip_accents(t):
    t = unicodedata.normalize("NFKD", t)
    return "".join(c for c in t if not unicodedata.combining(c))

def norm(w):
    w = w.replace(chr(0xFF27), "-")          # 全角G当连字符，先于NFKC
    w = unicodedata.normalize("NFKC", w)
    w = w.replace(chr(0x1001B3), "'")
    w = strip_accents(w)
    w = re.sub(r"[0-9]+$", "", w)            # 数字上标
    w = w.replace("(", "").replace(")", "")  # 括号变体
    w = w.split("/")[0]
    w = w.strip().lower()
    return SPECIAL.get(w, w)

# ---------- 3. ECDICT 全量 ----------
ec = {}
with open(base + r"\ecdict.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        ec[row["word"].lower()] = row

# ---------- 4. 合并 ----------
result, miss, seen = [], [], set()
for disp, lvl in official:
    key = norm(disp)
    if key in seen: continue
    seen.add(key)
    row = ec.get(key)
    if not row:
        miss.append((disp, key)); continue
    result.append({"word": key, "level": lvl,
                   "phonetic": row.get("phonetic", ""),
                   "definition": row.get("definition", ""),
                   "translation": row.get("translation", "")})

print("官方去重:", len(seen), " 合并成功:", len(result), " 未命中:", len(miss))
for d, k in miss: print("   ", repr(d), "->", repr(k))
n4 = sum(1 for r in result if r["level"]==4)
n6 = sum(1 for r in result if r["level"]==6)
print("四级(无★):", n4, " 六级(★):", n6)
ph = sum(1 for r in result if r["phonetic"])
print(f"音标覆盖: {ph}/{len(result)} ({ph/len(result)*100:.1f}%)  中文释义: {len(result)}/{len(result)}")

if not miss:
    out = base + r"\cet46-official-anchor.json"
    json.dump(result, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("已写出:", out, f"({os.path.getsize(out)/1024:.1f} KB)")
