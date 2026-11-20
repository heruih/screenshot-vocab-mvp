import json
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
data = json.load(open(base + r"\cet46-official-anchor.json", encoding="utf-8"))
by = {r["word"]: r for r in data}

print("=== 同形异义/编号词（看是否保留分列）===")
for w in ["bank","minute","present","bound","mean","mine","lead"]:
    r = by.get(w)
    print(f"  {w}: 级别{r['level'] if r else '缺'} | {(r['translation'][:40] if r else '')}")

print("\n=== 连字符/特殊词 ===")
for w in ["air-conditioning","x-ray","coup d'etat","o'clock","cliche","resume","microwaveable","honorary","according to"]:
    r = by.get(w)
    print(f"  {w}: {'有' if r else '缺'} | {(r['translation'][:30] if r else '')}")

print("\n=== 缺音标的 66 个词 ===")
noph = [r["word"] for r in data if not r["phonetic"]]
print(" ", noph)
