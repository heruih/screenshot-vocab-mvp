import pymupdf
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
pg = doc[34]
d = pg.get_text("dict")
for b in d["blocks"]:
    for l in b.get("lines", []):
        for sp in l["spans"]:
            x0,y0,x1,y1 = sp["bbox"]
            if x0 < 140 and 80 < y0 < 150:
                print(f"x0={x0:.0f} y0={y0:.0f} size={sp['size']:.1f} '{sp['text']}'")
