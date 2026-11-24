-- 006：付费订单登记表（线下收款 → 标记已收款 → 自动发包）
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  units INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_account_time ON orders(account_id, created_at);
