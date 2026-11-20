import pymupdf
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
d = doc[34].get_text("dict")
for bi in range(2, 9):
    b = d["blocks"][bi]
    print(f"=== BLOCK {bi} bbox={[round(x) for x in b['bbox']]}")
    for l in b.get("lines", []):
        print("   ", [(sp["text"], round(sp["size"],1)) for sp in l["spans"]])
