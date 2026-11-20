import pymupdf, re, unicodedata
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
lines, supers = [], []
for b in doc[34].get_text("dict")["blocks"]:
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
        if small_txt: supers.append([small_txt, x0, (y0+y1)/2])
        if text: lines.append([text, x0, y0, x1, (y0+y1)/2, lvl])

print("前6个正文:")
for ln in lines[:6]: print("  ", ln[0], "x1=",round(ln[3],1),"yc=",round(ln[4],1))
print("前3个上标:")
for s in supers[:3]: print("  ", s[0], "x0=",round(s[1],1),"yc=",round(s[2],1))
for num,sx,sy in supers[:3]:
    cands = [(ln[0], round(abs(ln[3]-sx),1), round(abs(ln[4]-sy),1)) for ln in lines if abs(ln[3]-sx)<=6 and abs(ln[4]-sy)<=7]
    print(f"上标{num} 候选:", cands)
