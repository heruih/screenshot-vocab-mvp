import pymupdf
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
for idx in range(20, 149):
    lines = [l for l in doc[idx].get_text().split("\n")]
    for i, l in enumerate(lines):
        if "fulfil" in l or "marvel" in l or "instal" in l:
            print(f"--- page idx{idx} 行{i}: {repr(lines[max(0,i-1):i+3])}")
