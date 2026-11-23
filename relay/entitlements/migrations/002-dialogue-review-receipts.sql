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
