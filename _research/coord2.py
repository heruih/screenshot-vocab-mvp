import pymupdf
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
doc = pymupdf.open(base + r"\cet-syllabus-2016.pdf")
pg = doc[34]  # bound 页
words = pg.get_text("words")  # x0,y0,x1,y1,word,block,line,wordno
# 找含 bound 或数字的条目，打印坐标
for w in words:
    txt = w[4]
    if "bound" in txt or txt in ("1","2","3"):
        print(f"x0={w[0]:.0f} y0={w[1]:.0f} x1={w[2]:.0f} y1={w[3]:.0f} '{txt}' block{w[5]} line{w[6]}")
