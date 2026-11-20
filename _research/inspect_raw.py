import pymupdf

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)

# 看第一个词表内容页（P21，索引20）和最后一页（P149，索引148）的原始 repr
for idx in [20, 148]:
    page = doc[idx]
    text = page.get_text()
    print(f"===== PDF page index {idx} (第{idx+1}页) raw repr =====")
    print(repr(text[:1200]))
    print()
