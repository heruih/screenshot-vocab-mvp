import pymupdf, re, unicodedata, json
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")

lines, supers = [], []
for idx in range(20, 149):
    for b in doc[idx].get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            text, lvl, small = "", 4, ""
            x0,y0,x1,y1 = l["bbox"]
            for sp in l["spans"]:
                if sp["size"] < 7:
                    nk = unicodedata.normalize("NFKC", sp["text"])
                    if re.fullmatch(r"[0-9]", nk): small += nk
                    continue
                if sp["text"] == "★": lvl = 6; continue
                text += sp["text"]
            if small: supers.append([idx, small, x0, (y0+y1)/2])
            if text: lines.append([idx, text, x0, y0, x1, (y0+y1)/2, lvl])

# 规则1：词内续接（同页、y重叠、x重叠）
merged = []
for ln in lines:
    if merged:
        p = merged[-1]
        if p[0]==ln[0] and abs(p[5]-ln[5])<5 and ln[2] <= p[4]+2:
            p[1] += ln[1]; p[4] = max(p[4], ln[4]); continue
    merged.append(ln)

# 规则2：上标同页坐标匹配
for pg, num, sx, sy in supers:
    for ln in merged:
        if ln[0]==pg and abs(ln[4]-sx)<=6 and abs(ln[5]-sy)<=7:
            ln[1] += num; break

# 规则3：跨行括号
out = []
for ln in merged:
    if ln[1].endswith("(") and out and out[-1][0]==ln[0]:
        out[-1][1] += ln[1]
    else:
        out.append(ln)

print("正文条目:", len(out))
bad = [x[1] for x in out if re.fullmatch(r"[0-9]+", x[1]) or x[1] in ("ing","ld")]
print("碎片:", bad)
for t in ["bound1","bound2","bound3","bank1","bank2","mean1","mean2","mean3","ag(e)ing","mo(u)ld"]:
    print(" ", t, "存在" if any(x[1]==t for x in out) else "缺")
json.dump([[x[1],x[6]] for x in out], open(base+r"\official_clean.json","w",encoding="utf-8"), ensure_ascii=False)
print("已存 official_clean.json，共", len(out))
