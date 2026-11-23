-- ============ 第一阶段权益体系建表（Cloudflare D1） ============
-- 全部为新增表，不读取、不修改任何已有用户数据。
-- 重新执行安全：每条都带 IF NOT EXISTS。
-- ===============================================================

-- 账号表：一个邮箱一行
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending=已验证待开通 / active=已开通 / disabled=停用
  created_at INTEGER NOT NULL,             -- 首次验证时间（ms）
  verified_at INTEGER,
  activated_at INTEGER,
  note TEXT
);

-- 每日用量：按账号 + 服务 + 北京日期计数
CREATE TABLE IF NOT EXISTS daily_usage (
  account_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                      -- text=DeepSeek / tts=CosyVoice
  day TEXT NOT NULL,                       -- YYYY-MM-DD（北京时间）
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, kind, day)
);

-- 加练包：手动发放的额外句数，长期有效、逐次扣减，不按天重置
CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                      -- text / tts
  amount INTEGER NOT NULL,                 -- 发放句数
  remaining INTEGER NOT NULL,              -- 剩余句数
  note TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER                       -- 可选过期时间（ms），NULL 表示长期有效
);
CREATE INDEX IF NOT EXISTS idx_grants_lookup ON grants(account_id, kind);

-- 月度成本：按北京年月一行，单位"微元"（1 元 = 1,000,000 微元，整数记账不丢零头）
CREATE TABLE IF NOT EXISTS monthly_cost (
  month TEXT PRIMARY KEY,                  -- YYYY-MM（北京时间）
  deepseek_micro INTEGER NOT NULL DEFAULT 0,
  cosyvoice_micro INTEGER NOT NULL DEFAULT 0,
  total_micro INTEGER NOT NULL DEFAULT 0,
  alert_sent INTEGER NOT NULL DEFAULT 0,   -- 100 元提醒是否已发，避免重复提醒
  updated_at INTEGER NOT NULL
);
