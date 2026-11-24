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
  note TEXT,
  welcome_tts_granted INTEGER NOT NULL DEFAULT 0, -- 一次性站方赠送语音是否已发放（防重复）
  unlimited INTEGER NOT NULL DEFAULT 0            -- 永久免费标记（1=永久免费，跳过用户额度扣减，站方成本照记）
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
  expires_at INTEGER,                      -- 可选过期时间（ms），NULL 表示长期有效
  source TEXT NOT NULL DEFAULT 'paid'      -- free=站方赠送 / paid=付费语音包
);
CREATE INDEX IF NOT EXISTS idx_grants_lookup ON grants(account_id, kind);

-- 月度成本：按北京年月一行，单位"微元"（1 元 = 1,000,000 微元，整数记账不丢零头）
CREATE TABLE IF NOT EXISTS monthly_cost (
  month TEXT PRIMARY KEY,                  -- YYYY-MM（北京时间）
  deepseek_micro INTEGER NOT NULL DEFAULT 0,
  cosyvoice_micro INTEGER NOT NULL DEFAULT 0,
  total_micro INTEGER NOT NULL DEFAULT 0,  -- 已结算总成本
  reserved_micro INTEGER NOT NULL DEFAULT 0, -- 在途已预留、未结算的预算（占用月度上限）
  alert_sent INTEGER NOT NULL DEFAULT 0,   -- 100 元提醒是否已发，避免重复提醒
  updated_at INTEGER NOT NULL
);
-- 旧库迁移（已存在 monthly_cost 但缺 reserved_micro 时执行；列已存在会报错，需手动跳过）：
-- ALTER TABLE monthly_cost ADD COLUMN reserved_micro INTEGER NOT NULL DEFAULT 0;

-- 预算待核对：上游结果不确定（超时/网络异常，可能已扣费）时挂起的预留，人工核对后再结算或释放
CREATE TABLE IF NOT EXISTS budget_hold (
  id TEXT PRIMARY KEY,                     -- 每次调用生成的预留 id
  month TEXT NOT NULL,
  service TEXT NOT NULL,                   -- text / tts
  max_micro INTEGER NOT NULL,              -- 预留的最高成本
  status TEXT NOT NULL DEFAULT 'held',     -- held=待核对 / settled=已转结算 / released=已释放
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_hold_lookup ON budget_hold(month, status);

-- 批改重试收据。只添加独立表，不改已有用户、复习或额度记录。
CREATE TABLE IF NOT EXISTS dialogue_review_request (
  account_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  allocation TEXT,
  result TEXT,
  completed_at INTEGER,
  PRIMARY KEY (account_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_dialogue_review_request_age
  ON dialogue_review_request(created_at);

-- 商业版内测意见反馈。仅新增收件箱，不修改账号、权益或学习记录。
CREATE TABLE IF NOT EXISTS feedback_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  message TEXT NOT NULL,
  allow_reply INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_message_account_time
  ON feedback_message(account_id, created_at);

-- 付费订单：线下收款登记。金额以「分」整数存储，避免浮点误差。
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  email TEXT NOT NULL,                    -- 冗余存邮箱，方便后台展示
  kind TEXT NOT NULL,                     -- text=AI 加练 / tts=CosyVoice 语音
  units INTEGER NOT NULL,                 -- 发放句数
  amount_cents INTEGER NOT NULL,          -- 收款金额（分）
  plan TEXT,                              -- 套餐名（如「体验包 100 句」）
  status TEXT NOT NULL DEFAULT 'pending', -- pending=待收款 / paid=已收款已发包
  note TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_account_time ON orders(account_id, created_at);
