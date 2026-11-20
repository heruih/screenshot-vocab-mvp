import pymupdf
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
for idx in (22, 93):
    print(f"===== idx{idx}")
    for b in doc[idx].get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(sp["text"] for sp in l["spans"])
            if "ag(e)" in t or t=="ing" or "mo(u)" in t or t=="ld" or "aged" in t or "moldy" in t or "mo(u)ldy" in t:
                x0,y0,x1,y1=l["bbox"]
                print(f"  x0={x0:.1f} yc={(y0+y1)/2:.1f} x1={x1:.1f} '{t}'")
