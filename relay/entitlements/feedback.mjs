/* 首批内测反馈使用现有 D1，独立于预算及用户学习数据。 */
const MAX_MESSAGE_LENGTH = 1600;
const MAX_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 50;

export async function submitFeedback(db, accountId, input) {
  const requestId = input?.requestId;
  const message = typeof input?.message === 'string' ? input.message.trim() : '';
  const allowReply = input?.allowReply === true ? 1 : 0;
  if (typeof requestId !== 'string' || !/^[0-9a-f]{32}$/.test(requestId) ||
      !message || message.length > MAX_MESSAGE_LENGTH) {
    return { status: 400, message: '请输入 1–1600 字的反馈内容，再提交。' };
  }
  const now = Date.now();
  const created = await db.prepare(`
    INSERT OR IGNORE INTO feedback_message (account_id, request_id, message, allow_reply, created_at)
    SELECT ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM feedback_message WHERE account_id = ? AND created_at >= ?) < ?
    RETURNING id
  `).bind(accountId, requestId, message, allowReply, now, accountId, now - DAY_MS, MAX_PER_DAY).first();
  if (created) return { status: 201 };

  const prior = await db.prepare('SELECT message, allow_reply FROM feedback_message WHERE account_id = ? AND request_id = ?')
    .bind(accountId, requestId).first();
  if (!prior) return { status: 429, message: '这 24 小时已提交 5 条反馈，请晚些再试。' };
  if (prior.message !== message || prior.allow_reply !== allowReply) {
    return { status: 409, message: '反馈内容已变更，请重新提交。' };
  }
  return { status: 200 };
}

export async function listFeedback(db, before) {
  const cursor = Number.isSafeInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER;
  const { results } = await db.prepare(`
    SELECT f.id, f.created_at AS createdAt, f.message,
      CASE WHEN f.allow_reply = 1 THEN a.email ELSE NULL END AS replyEmail
    FROM feedback_message f LEFT JOIN accounts a ON a.id = f.account_id
    WHERE f.id < ? ORDER BY f.id DESC LIMIT ?
  `).bind(cursor, PAGE_SIZE + 1).all();
  const entries = results.slice(0, PAGE_SIZE);
  return { entries, next: results.length > PAGE_SIZE ? entries.at(-1).id : null };
}
