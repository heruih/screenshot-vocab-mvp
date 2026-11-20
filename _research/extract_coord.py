import pymupdf, re, unicodedata
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")

items = []  # (text, level)
for idx in range(20, 149):
    for b in doc[idx].get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            buf, lvl = "", 4
            for sp in l["spans"]:
                t = sp["text"]
                small = sp["size"] < 7
                if t == "★":
                    lvl = 6; continue
                if small and re.fullmatch(r"[０-９0-9]", unicodedata.normalize("NFKC", t)):
                    buf += str(int(unicodedata.normalize("NFKC", t)))  # 上标贴回
                    continue
                if buf:
                    items.append((buf, lvl)); buf = ""
                lvl = 6 if t=="★" else lvl
                buf += t
            if buf: items.append((buf, lvl))

# 跨行括号合并
merged = []
for t, lvl in items:
    if t.endswith("(") and merged:
        merged[-1] = (merged[-1][0] + t, merged[-1][1])
    else:
        merged.append((t, lvl))

print("总条目:", len(merged))
# 检查碎片
bad = [t for t,_ in merged if t in ("ing","ld","2","3") or re.fullmatch(r"[0-9]+", t)]
print("碎片:", bad)
# 编号词样例
nums = [t for t,_ in merged if re.search(r"[0-9]$", t)]
print("带上标词数:", len(nums), "样例:", nums[:12])
for t in ["bound1","bound2","bound3","bank1","bank2","mean1","mean2","mean3"]:
    print(" ", t, "存在" if any(x==t for x,_ in merged) else "缺")
