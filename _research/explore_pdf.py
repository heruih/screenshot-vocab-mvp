import pymupdf

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)
print("总页数:", doc.page_count)

# 打印每页前 60 个字符，定位词表起始页
for i, page in enumerate(doc):
    text = page.get_text().strip().replace("\n", " ")
    head = text[:80]
    print(f"[P{i+1}] {head}")
