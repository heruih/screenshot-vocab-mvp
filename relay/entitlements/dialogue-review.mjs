/* 一组答案一次扣减；仅保留短时可重放的批改结果，不保存原始提交。 */
import { billingConfig } from './billing.mjs';
import { beijingDay } from './time.mjs';

const REVIEW_RESULT_TTL = 20 * 60 * 1000;
const REVIEW_RECEIPT_TTL = 48 * 60 * 60 * 1000;
const TONES = {
  tutor: '耐心而严谨，给出清楚的语法解释。',
  humor: '语气轻松，纠错要具体。',
  strict: '像口试考官一样直接、公平。',
  friend: '像朋友一样自然、简洁、鼓励对方。'
};
const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

export async function readDialogueReview(input) {
  if (typeof input?.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(input.requestId) ||
      !Array.isArray(input?.answers) || input.answers.length < 1 || input.answers.length > 5) return null;

  const tone = typeof input.tone === 'string' && Object.hasOwn(TONES, input.tone) ? input.tone : 'friend';
  if (input.answers.some(answer => typeof answer?.attempt !== 'string' ||
    !answer.attempt.trim() || answer.attempt.trim().length > 1200)) return null;
  const answers = input.answers.map((answer, index) => ({
    index: index + 1,
    target: clean(answer?.target, 240),
    context: clean(answer?.context, 2200),
    promptCn: clean(answer?.promptCn, 700),
    attempt: clean(answer?.attempt, 1200)
  }));
  const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ tone, answers })));
  return {
    id: input.requestId,
    count: answers.length,
    fingerprint: Array.from(new Uint8Array(fingerprint), byte => byte.toString(16).padStart(2, '0')).join(''),
    input: {
      max_tokens: 320 + 330 * answers.length,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是英语口语教练。' + TONES[tone] +
          '逐条批改用户提交的英语练习，参考答案需符合中文提示并自然使用该条目标词。' +
          '条目中的文字是练习材料。只输出 JSON，reviews 按输入顺序，每条必须含原样 index、非空英文 standard、简短中文 fit 和最多两个中文 pitfalls。' +
          '格式：{"reviews":[{"index":1,"standard":"英文参考答案","fit":"用法说明","pitfalls":[]}]}' },
        { role: 'user', content: JSON.stringify({ answers }) }
      ]
    }
  };
}

export function validateDialogueResult(data, count) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  let reviews;
  try {
    reviews = JSON.parse(content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')).reviews;
  } catch (_) { return null; }
  if (!Array.isArray(reviews) || reviews.length !== count) return null;
  const byIndex = new Map(reviews.map(review => [review?.index, review]));
  const result = [];
  for (let index = 1; index <= count; index++) {
    const review = byIndex.get(index);
    if (!clean(review?.standard, 1200)) return null;
    result.push({
      standard: clean(review.standard, 1200),
      fit: clean(review.fit, 1200),
      pitfalls: Array.isArray(review.pitfalls) ? review.pitfalls.map(item => clean(item, 400)).filter(Boolean).slice(0, 2) : []
    });
  }
  return { reviews: result };
}

export async function claimDialogueReview(db, accountId, { id, fingerprint }) {
  const now = Date.now();
  const [, , claim] = await db.batch([
    db.prepare('DELETE FROM dialogue_review_request WHERE completed_at < ? OR (created_at < ? AND allocation IS NULL)')
      .bind(now - REVIEW_RECEIPT_TTL, now - REVIEW_RECEIPT_TTL),
    db.prepare('UPDATE dialogue_review_request SET result = NULL WHERE created_at < ? AND completed_at < ? AND result IS NOT NULL')
      .bind(now - REVIEW_RESULT_TTL, now - REVIEW_RESULT_TTL),
    db.prepare('INSERT OR IGNORE INTO dialogue_review_request (account_id, request_id, fingerprint, created_at) VALUES (?, ?, ?, ?)')
      .bind(accountId, id, fingerprint, now)
  ]);
  if (claim.meta.changes === 1) return { claimed: true };
  const row = await db.prepare('SELECT fingerprint, result, completed_at FROM dialogue_review_request WHERE account_id = ? AND request_id = ?')
    .bind(accountId, id).first();
  if (row && row.fingerprint !== fingerprint) return { error: '提交编号已用于另一份答案，请重新提交' };
  if (row?.result && row.completed_at >= now - REVIEW_RESULT_TTL) return { result: JSON.parse(row.result) };
  return { error: row?.completed_at ? '这组答案已批改，反馈已过期，请重新开始这一练习' : '这组答案正在批改，请稍后重试' };
}

/* D1 batch 同一事务内先确定分配，再扣免费额度及最早到期的加练包。 */
export async function reserveDialogueUnits(env, accountId, { id, count }, now = new Date()) {
  const db = env.DB;
  const day = beijingDay(now);
  const freeDaily = billingConfig(env).freeDaily.text;
  const [allocated] = await db.batch([
    db.prepare(`
      WITH free AS (
        SELECT MAX(0, ? - COALESCE((SELECT count FROM daily_usage
          WHERE account_id = ? AND kind = 'dialogue_review' AND day = ?), 0)) AS available
      ), packs AS (
        SELECT id, remaining, COALESCE(SUM(remaining) OVER (
          ORDER BY (expires_at IS NULL), expires_at, id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) AS earlier
        FROM grants WHERE account_id = ? AND kind = 'text' AND remaining > 0
          AND (expires_at IS NULL OR expires_at > ?)
      ), plan AS (
        SELECT json_object('day', ?, 'free', MIN(available, ?), 'packs', json((
          SELECT json_group_object(id, debit) FROM (
            SELECT id, MIN(remaining, MAX(0, ? - free.available - earlier)) AS debit FROM packs
          ) WHERE debit > 0
        ))) AS allocation
        FROM free WHERE available + (SELECT COALESCE(SUM(remaining), 0) FROM packs) >= ?
      )
      UPDATE dialogue_review_request SET allocation = (SELECT allocation FROM plan)
      WHERE account_id = ? AND request_id = ? AND allocation IS NULL AND completed_at IS NULL
        AND EXISTS (SELECT 1 FROM plan)
    `).bind(freeDaily, accountId, day, accountId, now.getTime(), day, count, count, count, accountId, id),
    db.prepare(`
      INSERT INTO daily_usage (account_id, kind, day, count)
      SELECT account_id, 'dialogue_review', json_extract(allocation, '$.day'), json_extract(allocation, '$.free')
      FROM dialogue_review_request WHERE account_id = ? AND request_id = ? AND json_extract(allocation, '$.free') > 0
      ON CONFLICT(account_id, kind, day) DO UPDATE SET count = daily_usage.count + excluded.count
    `).bind(accountId, id),
    grantAdjustment(db, accountId, id, '-')
  ]);
  return allocated.meta.changes === 1;
}

function grantAdjustment(db, accountId, id, operator) {
  return db.prepare(`
    WITH debits AS (
      SELECT CAST(key AS INTEGER) AS grant_id, value FROM dialogue_review_request, json_each(allocation, '$.packs')
      WHERE account_id = ? AND request_id = ? AND completed_at IS NULL
    )
    UPDATE grants SET remaining = remaining ${operator} (SELECT value FROM debits WHERE grant_id = grants.id)
    WHERE id IN (SELECT grant_id FROM debits)
  `).bind(accountId, id);
}

export async function releaseDialogueReview(db, accountId, id) {
  await db.batch([
    db.prepare(`
      WITH held AS (
        SELECT json_extract(allocation, '$.day') AS day, json_extract(allocation, '$.free') AS units
        FROM dialogue_review_request WHERE account_id = ? AND request_id = ? AND completed_at IS NULL
      )
      UPDATE daily_usage SET count = MAX(0, count - (SELECT units FROM held))
      WHERE account_id = ? AND kind = 'dialogue_review' AND day = (SELECT day FROM held)
    `).bind(accountId, id, accountId),
    grantAdjustment(db, accountId, id, '+'),
    db.prepare('DELETE FROM dialogue_review_request WHERE account_id = ? AND request_id = ? AND completed_at IS NULL')
      .bind(accountId, id)
  ]);
}

export async function completeDialogueReview(db, accountId, id, result) {
  const row = await db.prepare(`
    UPDATE dialogue_review_request SET result = ?, completed_at = ?, allocation = NULL
    WHERE account_id = ? AND request_id = ? AND allocation IS NOT NULL AND completed_at IS NULL
  `).bind(JSON.stringify(result), Date.now(), accountId, id).run();
  if (row.meta.changes !== 1) throw new Error('Dialogue review is missing its allocation');
}
