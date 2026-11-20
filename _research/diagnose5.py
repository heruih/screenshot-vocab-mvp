import pymupdf, re

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)

def clean_lines(idx):
    out=[]
    for raw in doc[idx].get_text().split("\n"):
        s=raw.strip().replace("　","").strip()
        if not s: continue
        if "全国大学英语" in s or "词表" in s: continue
        if re.fullmatch(r"[0-9０-９]+",s): continue
        if s in ("词","表"): continue
        out.append(s)
    return out

# 打印 P21(索引20) 全部干净行，带序号
lines = clean_lines(20)
print("P21 干净行数:", len(lines))
for i,l in enumerate(lines):
    print(f"  {i+1}: {repr(l)}")
