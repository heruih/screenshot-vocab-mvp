import json
base = r"C:\Users\19394\DoubaoWork\chats\2026-11-18\new-chat\截图词库MVP\_research"
data = json.load(open(base + r"\cet46-official-anchor.json", encoding="utf-8"))

# 结构校验
assert all(r["word"] and r["level"] in (4,6) and r["translation"] for r in data)
words = [r["word"] for r in data]
assert len(words) == len(set(words)), "有重复"
print("结构校验通过：无空词、无重复、级别合法、释义齐全")

# 排序检查（应按字母序）
print("是否字母序:", words == sorted(words))

# 头中尾抽查
import random
for i in [0, 1, 2500, 5000, 7805]:
    r = data[i]
    print(f"  [{i}] {r['word']} (级{r['level']}) /{r['phonetic']}/ {r['translation'][:28]}")

# 派生词与基础词都在
for w in ["able","ability","amaze","amazing","amazement","a","the","algorithm","smartphone","swipe"]:
    print("  ", w, "在" if w in words else "缺")
