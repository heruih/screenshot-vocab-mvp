import pymupdf

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)

# 1) 找所有 'a/an' 出现的页（判断词表是否分两段）
print("=== 'a/an' 出现位置 ===")
for idx in range(19, 149):
    for raw in doc[idx].get_text().split("\n"):
        if raw.strip().replace("　","") in ("a/an",):
            print(f"  P{idx+1}")

# 2) P30 两个 bank 的坐标 + 该页所有 word 的 x0 范围（判断单/双栏）
page = doc[29]
print("\n=== P30 页面尺寸 ===", page.rect)
words = page.get_text("words")  # x0,y0,x1,y1,word,block,line,word_no
print("该页 word 数:", len(words))
xs = sorted(set(round(w[0]) for w in words))
print("不同 x0 数量:", len(xs), " 最小几个:", xs[:6], " 最大几个:", xs[-6:])
print("\n=== 两个 bank 的坐标 ===")
for w in words:
    if w[4] == "bank":
        print("  x0=%s y0=%s x1=%s y1=%s block=%s" % (w[0],w[1],w[2],w[3],w[5]))

# 3) 看 block 数量（双栏通常 2 个大 block）
blocks = page.get_text("blocks")
print("\n=== P30 block 数:", len(blocks), "===")
for b in blocks[:6]:
    print("  x0=%s y0=%s x1=%s y1=%s" % (round(b[0]),round(b[1]),round(b[2]),round(b[3])))
