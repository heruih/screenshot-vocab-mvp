import pymupdf, re, unicodedata
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
targets = {"ing","ld","2"}
for idx in range(20, 149):
    lines = [l.strip().replace("　", "").strip() for l in doc[idx].get_text().split("\n")]
    for i, l in enumerate(lines):
        nk = unicodedata.normalize("NFKC", l)
        if nk in targets or nk.lower() in targets:
            print(f"idx{idx} 行{i}: {repr(lines[max(0,i-2):i+3])}")
