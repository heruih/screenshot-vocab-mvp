import json, re
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
items = json.load(open(base + r"\official_clean.json", encoding="utf-8"))
# 找编号词，按词干分组
groups = {}
for w, lvl in items:
    m = re.match(r"^(.+?)([0-9]+)$", w)
    if m:
        groups.setdefault(m.group(1), []).append((w, lvl))
diff = 0
for stem, lst in groups.items():
    lvls = set(x[1] for x in lst)
    if len(lvls) > 1:
        diff += 1
        print("级别不一致:", lst)
print("编号词干总数:", len(groups), " 级别不一致数:", diff)
print("\n样例:")
for stem in ["bank","bound","mean","minute","present","mine"]:
    print(" ", groups.get(stem))
