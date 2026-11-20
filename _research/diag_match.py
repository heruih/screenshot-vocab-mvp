import pymupdf, re, unicodedata
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
for b in doc[34].get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        txt = "".join(sp["text"] for sp in l["spans"])
        if "bound" in txt or txt in ("１","２","３"):
            x0,y0,x1,y1 = l["bbox"]
            print(f"line bbox x0={x0:.1f} y0={y0:.1f} x1={x1:.1f} y1={y1:.1f} yc={(y0+y1)/2:.1f} '{txt}'")
