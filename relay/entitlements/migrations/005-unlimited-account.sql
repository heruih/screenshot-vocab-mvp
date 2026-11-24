-- 005：永久免费账号标记。新增列，不改已有数据。
ALTER TABLE accounts ADD COLUMN unlimited INTEGER NOT NULL DEFAULT 0;
