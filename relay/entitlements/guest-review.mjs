import { readDialogueReview } from './dialogue-review.mjs';
import { beijingDay } from './time.mjs';

const DAY_LIMIT = 30;
const NETWORK_LIMIT = 6;
const RECEIPT_AGE = 7 * 24 * 60 * 60 * 1000;
const RESULT_AGE = 24 * 60 * 60 * 1000;
const LIMIT_CONDITION =
  '(SELECT COALESCE(SUM(attempts), 0) FROM guest_review_trial WHERE day = ?) < ? ' +
  'AND (SELECT COALESCE(SUM(attempts), 0) FROM guest_review_trial WHERE day = ? AND network = ?) < ?';

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function guestReviewInput(body, request) {
  if (typeof body?.trialId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.trialId) ||
      typeof body.attempt !== 'string' || !body.attempt.trim() || body.attempt.length > 300) return null;
  const now = new Date(), day = beijingDay(now);
  const [visitor, network, review] = await Promise.all([
    digest(body.trialId.toLowerCase()),
    digest(day + ':' + (request.headers.get('CF-Connecting-IP') || 'unknown')),
    readDialogueReview({ requestId: body.trialId, answers: [{
      target: 'notice',
      context: 'I can’t find my bag.',
      promptCn: '告诉对方：我注意到你的包在门边。',
      attempt: body.attempt
    }] })
  ]);
  return { visitor, network, day, now: now.getTime(), review };
}

export async function claimGuestReview(db, { visitor, network, day, now, review }) {
  await db.batch([
    db.prepare('DELETE FROM guest_review_trial WHERE created_at < ?').bind(now - RECEIPT_AGE),
    db.prepare('UPDATE guest_review_trial SET result = NULL WHERE result IS NOT NULL AND created_at < ?').bind(now - RESULT_AGE)
  ]);
  const limits = [day, DAY_LIMIT, day, network, NETWORK_LIMIT];
  const inserted = await db.prepare(
    'INSERT OR IGNORE INTO guest_review_trial (visitor, day, network, fingerprint, created_at) ' +
    'SELECT ?, ?, ?, ?, ? WHERE ' + LIMIT_CONDITION
  ).bind(visitor, day, network, review.fingerprint, now, ...limits).run();
  if (inserted.meta.changes === 1) return { claimed: true };

  const receipt = await db.prepare('SELECT state, fingerprint, result, day, network, attempts FROM guest_review_trial WHERE visitor = ?')
    .bind(visitor).first();
  if (!receipt) return { status: 429, message: '今日访客体验暂不可用，可以登录继续或稍后试试。' };
  if (receipt.state === 'done') {
    if (receipt.result && receipt.fingerprint === review.fingerprint) return { result: JSON.parse(receipt.result) };
    return { status: 409, message: '访客体验已用过，登录后可以继续练习。' };
  }
  if (receipt.state === 'pending') return { status: 409, message: '正在批改，请稍后原样重试。' };
  const unavailable = { status: 429, message: '访客批改暂不可用，请稍后或登录继续。' };
  if (receipt.day !== day || receipt.attempts >= 2) return unavailable;
  const retry = await db.prepare(
    "UPDATE guest_review_trial SET state = 'pending', attempts = attempts + 1, fingerprint = ? " +
    "WHERE visitor = ? AND state = 'retry' AND attempts = 1 AND day = ? AND " + LIMIT_CONDITION
  ).bind(review.fingerprint, visitor, day, day, DAY_LIMIT, day, receipt.network, NETWORK_LIMIT).run();
  return retry.meta.changes === 1 ? { claimed: true } : unavailable;
}

export async function finishGuestReview(db, visitor, result) {
  await db.prepare("UPDATE guest_review_trial SET state = ?, result = ? WHERE visitor = ? AND state = 'pending'")
    .bind(result ? 'done' : 'retry', result ? JSON.stringify(result) : null, visitor).run();
}
