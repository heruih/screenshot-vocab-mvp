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
