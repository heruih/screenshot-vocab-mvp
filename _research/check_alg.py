import json, csv
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
items = json.load(open(base + r"\official_clean.json", encoding="utf-8"))
alg = [w for w,_ in items if "alg" in w.lower()]
print("官方词表含 alg 的词:", alg)
with open(base+r"\ecdict.csv",encoding="utf-8") as f:
    for r in csv.DictReader(f):
        if r["word"].lower()=="algorithm":
            print("ECDICT algorithm 标签:", r["tag"], "| 释义:", r["translation"][:30])
