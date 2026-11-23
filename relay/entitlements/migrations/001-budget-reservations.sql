-- 基于 01e11bf 的旧 D1。迁移前确认 monthly_cost 已存在且没有 reserved_micro。
-- 按版本登记，只应用一次。新增列默认 0，原有月账、账号和加练包保留。
ALTER TABLE monthly_cost ADD COLUMN reserved_micro INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS budget_hold (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  service TEXT NOT NULL,
  max_micro INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_hold_lookup ON budget_hold(month, status);
