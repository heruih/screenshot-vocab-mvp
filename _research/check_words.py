import csv
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
ec = {}
with open(base + r"\ecdict.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        ec[row["word"].lower()] = row
for q in ["microwavable","microwaveable","honorary","honourary","coup d'etat","coup d'etat","aids","air-conditioning","x-ray","cliche","resume","o'clock"]:
    r = ec.get(q.lower())
    print(q, "->", (r["word"] if r else "无"), "|", (r["translation"][:30] if r else ""))
