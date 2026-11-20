import json, re, csv, unicodedata, os
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"

official = json.load(open(base + r"\official_clean.json", encoding="utf-8"))

SPECIAL = {"accordingto":"according to","babyboomer":"baby boomer","oughtto":"ought to","owingto":"owing to",
           "microwavable":"microwaveable","honourary":"honorary","coupd'etat":"coup d'etat"}
def strip_accents(t):
    return "".join(c for c in unicodedata.normalize("NFKD",t) if not unicodedata.combining(c))
def norm(w):
    w = w.replace(chr(0xFF27),"-")
    w = unicodedata.normalize("NFKC", w)
    w = w.replace(chr(0x1001B3),"'")
    w = strip_accents(w)
    w = re.sub(r"[0-9]+$","",w)
    w = w.replace("(","").replace(")","")
    w = w.split("/")[0].strip().lower()
    return SPECIAL.get(w,w)

# 同形异义聚合，级别取最高
lvl_map = {}
for w, lvl in official:
    if "全国大学英语" in w or "考试大纲" in w or w in ("词","表"): continue
    k = norm(w)
    if k: lvl_map[k] = max(lvl_map.get(k,4), lvl)

ec = {}
with open(base+r"\ecdict.csv",encoding="utf-8") as f:
    for r in csv.DictReader(f): ec[r["word"].lower()] = r

result, miss = [], []
for k, lvl in sorted(lvl_map.items()):
    row = ec.get(k)
    if not row: miss.append(k); continue
    result.append({"word":k,"level":lvl,"phonetic":row.get("phonetic",""),
                   "definition":row.get("definition",""),"translation":row.get("translation","")})

n4=sum(1 for r in result if r["level"]==4); n6=sum(1 for r in result if r["level"]==6)
ph=sum(1 for r in result if r["phonetic"])
print("最终锚点词数:",len(result)," 四级:",n4," 六级:",n6)
print(f"音标覆盖 {ph}/{len(result)} ({ph/len(result)*100:.1f}%)  中文释义 {len(result)}/{len(result)}")
print("未命中:",miss)
# 验证4个特殊级别
for w in ["appropriate","converse","invalid","staple"]:
    print(" ",w,"级别",next(r["level"] for r in result if r["word"]==w))
if not miss:
    out=base+r"\cet46-official-anchor.json"
    json.dump(result,open(out,"w",encoding="utf-8"),ensure_ascii=False,separators=(",",":"))
    print("已写出:",out,f"({os.path.getsize(out)/1024:.1f} KB)")
