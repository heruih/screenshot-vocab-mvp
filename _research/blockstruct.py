import pymupdf
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
d = doc[34].get_text("dict")
for bi, b in enumerate(d["blocks"][:3]):
    print(f"=== BLOCK {bi} bbox={[round(x) for x in b['bbox']]}")
    for li, l in enumerate(b.get("lines", [])):
        spans = [(sp["text"], round(sp["size"],1), round(sp["bbox"][0])) for sp in l["spans"]]
        print(f"  line{li} y={round(l['bbox'][1])}: {spans}")
