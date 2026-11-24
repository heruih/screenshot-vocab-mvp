-- 站方语音：一次性赠送 + 免费/付费分离。
-- 基于 004 之前的旧 D1。迁移前确认 grants 已存在且无 source 列、accounts 无 welcome_tts_granted 列。
-- 只新增列，原有账目、账号和加练包保留；列已存在的环境跳过重复加列。
ALTER TABLE grants ADD COLUMN source TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE accounts ADD COLUMN welcome_tts_granted INTEGER NOT NULL DEFAULT 0;
