import pymupdf, re, unicodedata
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")

lines, supers = [], []   # line: [text,x0,y0,x1,yc,level]
for idx in range(20, 149):
    for b in doc[idx].get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            text, lvl, small_txt = "", 4, ""
            x0,y0,x1,y1 = l["bbox"]
            for sp in l["spans"]:
                if sp["size"] < 7:
                    nk = unicodedata.normalize("NFKC", sp["text"])
                    if re.fullmatch(r"[0-9]", nk): small_txt += nk
                    continue
                if sp["text"] == "★": lvl = 6; continue
                text += sp["text"]
            if small_txt:
                supers.append([small_txt, x0, (y0+y1)/2])
            if text:
                lines.append([text, x0, y0, x1, (y0+y1)/2, lvl])

# 上标按坐标贴回左侧正文行
for num, sx, sy in supers:
    best = None
    for ln in lines:
        if abs(ln[3]-sx) <= 6 and abs(ln[4]-sy) <= 7:
            best = ln; break
    if best: best[0] += num

# 跨行括号合并
out = []
for ln in lines:
    if ln[0].endswith("(") and out:
        out[-1][0] += ln[0]
    else:
        out.append(ln)

print("正文条目:", len(out), " 上标block:", len(supers))
bad = [x[0] for x in out if re.fullmatch(r"[0-9]+", x[0]) or x[0] in ("ing","ld")]
print("碎片:", bad)
for t in ["bound1","bound2","bound3","bank1","bank2","mean1","mean2","mean3"]:
    print(" ", t, "存在" if any(x[0]==t for x in out) else "缺")
import json
json.dump([[x[0],x[5]] for x in out], open(base+r"\official_clean.json","w",encoding="utf-8"), ensure_ascii=False)
print("已存 official_clean.json")
