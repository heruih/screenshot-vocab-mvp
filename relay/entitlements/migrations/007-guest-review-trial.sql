-- 访客示例批改独立收据，可重复执行，回退时保留旧表与现有数据。
CREATE TABLE IF NOT EXISTS guest_review_trial (
  visitor TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  network TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_review_trial_day ON guest_review_trial(day, network);
CREATE INDEX IF NOT EXISTS idx_guest_review_trial_age ON guest_review_trial(created_at);
