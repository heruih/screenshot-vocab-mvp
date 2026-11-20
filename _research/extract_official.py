import pymupdf, re, json

pdf_path = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\cet-syllabus-2016.pdf"
doc = pymupdf.open(pdf_path)

entries = []  # (word, level)  level: 4 or 6
for idx in range(20, 149):  # 词目内容页 索引20..148
    page = doc[idx]
    for raw in page.get_text().split("\n"):
        line = raw.strip().replace("　", "").strip()
        if not line:
            continue
        if "全国大学英语" in line or "词表" in line or "词　表" in line:
            continue
        if re.fullmatch(r"[0-9０-９]+", line):  # 页码、统计数字
            continue
        level = 4
        if line.startswith("★"):
            level = 6
            line = line[1:].strip()
        if line:
            entries.append((line, level))

print("解析总词目数:", len(entries), " 官方应为 5418")
lvl6 = [w for w, l in entries if l == 6]
lvl4 = [w for w, l in entries if l == 4]
print("六级(★)词数:", len(lvl6), " 官方应为 2551")
print("四级词数:", len(lvl4), " 应为", 5418 - 2551)

# 检查重复
words_all = [w for w, _ in entries]
dups = sorted({w for w in words_all if words_all.count(w) > 1})
print("\n重复条目:", dups)

# 特殊/异常条目：含空格、数字、非ascii字母(除常见连字符/斜杠/括号/星号)
def is_special(w):
    if " " in w or re.search(r"[0-9]", w):
        return True
    # 允许的字符外的非ascii
    for ch in w:
        if ord(ch) > 127:
            return True
    return False

special = sorted({w for w, _ in entries if is_special(w)})
print("\n含特殊字符/数字/空格的条目数:", len(special))
for w in special:
    print("  ", repr(w))

# 保存原始提取
out = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research\official_raw.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump([{"word": w, "level": l} for w, l in entries], f, ensure_ascii=False, indent=0)
print("\n已保存 official_raw.json")
