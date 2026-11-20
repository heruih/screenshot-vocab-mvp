import pymupdf, re
from collections import Counter

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)
entries=[]
for idx in range(20,149):
    for raw in doc[idx].get_text().split("\n"):
        s=raw.strip().replace("　","").strip()
        if not s: continue
        if "全国大学英语" in s or "词表" in s or s in ("词","表"): continue
        if re.fullmatch(r"[0-9０-９]",s):
            if entries: entries[-1]+=str(int(s))
            continue
        if re.fullmatch(r"[0-9０-９]+",s): continue
        if s.startswith("★"): s=s[1:]
        entries.append(s)
uniq=sorted(set(entries))

cats=Counter()
for w in uniq:
    if re.search(r"[0-9]",w): cats["含数字上标"]+=1
    elif "/" in w: cats["含斜杠变体"]+=1
    elif "(" in w or ")" in w: cats["含括号"]+=1
    elif "Ｇ" in w or "-" in w: cats["含连字符"]+=1
    elif re.fullmatch(r"[A-Za-z'.]+",w): cats["纯字母常规词"]+=1
    else: cats["其它特殊"]+=1
print("unique 总数:", len(uniq))
for k,v in cats.items(): print(f"  {k}: {v}")

# 看“其它特殊”有哪些
other=[w for w in uniq if not (re.search(r"[0-9]",w) or "/" in w or "(" in w or ")" in w or "Ｇ" in w or "-" in w or re.fullmatch(r"[A-Za-z'.]+",w))]
print("\n其它特殊示例(前30):")
for w in other[:30]: print("  ",repr(w))
