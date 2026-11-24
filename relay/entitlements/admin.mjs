/* ============ 管理员操作（手动开通 / 发加练包 / 账号管理） ============
 * 所有操作都凭 ADMIN_TOKEN 校验，token 存 Secret，不进代码库。
 * ================================================================= */

import { getAccountByEmail } from './accounts.mjs';
import { billingConfig, getStatus } from './billing.mjs';

export function isAdmin(env, token) {
  return !!env.ADMIN_TOKEN && String(token) === String(env.ADMIN_TOKEN);
}

/* 列出账号，可按状态过滤 */
export async function listAccounts(env, status) {
  if (status) {
    const res = await env.DB.prepare('SELECT * FROM accounts WHERE status = ? ORDER BY created_at DESC')
      .bind(status).all();
    return res.results;
  }
  const res = await env.DB.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all();
  return res.results;
}

/* 手动开通：把 pending/其他状态改为 active，并发放一次性站方赠送语音 */
export async function activate(env, email) {
  const acc = await getAccountByEmail(env.DB, email);
  if (!acc) return { ok: false, status: 404, message: '没有这个邮箱的账号，请先让用户在 App 内验证邮箱' };
  const now = Date.now();
  await env.DB.prepare("UPDATE accounts SET status = 'active', activated_at = ? WHERE id = ?")
    .bind(acc.activated_at || now, acc.id).run();
  await ensureWelcomeTts(env, await getAccountByEmail(env.DB, email));
  return { ok: true, account: await getAccountByEmail(env.DB, email) };
}

/* 一次性站方赠送语音：开通账号默认给 welcomeTts 句（可配置），重复开通/登录不重发。
 * 用条件 UPDATE 保证并发下只发一次；发送失败可下次登录再补。 */
export async function ensureWelcomeTts(env, account) {
  if (!account || account.status !== 'active') return { granted: false };
  const count = billingConfig(env).welcomeTts;
  if (!Number.isSafeInteger(count) || count <= 0) return { granted: false };
  const marked = await env.DB.prepare(
    'UPDATE accounts SET welcome_tts_granted = 1 WHERE id = ? AND welcome_tts_granted = 0'
  ).bind(account.id).run();
  if (marked.meta.changes !== 1) return { granted: false };   /* 已发过或并发抢占失败 */
  await env.DB.prepare(
    "INSERT INTO grants (account_id, kind, amount, remaining, note, created_at, expires_at, source) " +
    "VALUES (?, 'tts', ?, ?, '站方赠送', ?, NULL, 'free')"
  ).bind(account.id, count, count, Date.now()).run();
  return { granted: true, amount: count };
}

/* 手动发加练包：kind=text/tts，amount=句数，可带备注与过期时间；source 默认 paid */
export async function grant(env, email, kind, amount, note, expiresAt, source) {
  const acc = await getAccountByEmail(env.DB, email);
  if (!acc) return { ok: false, status: 404, message: '没有这个邮箱的账号' };
  if (!['text', 'tts'].includes(kind)) return { ok: false, status: 400, message: '类型必须是 text 或 tts' };
  const amt = parseInt(amount, 10);
  if (!Number.isSafeInteger(amt) || amt <= 0) return { ok: false, status: 400, message: '数量必须是正整数' };
  const exp = expiresAt ? parseInt(expiresAt, 10) : null;
  const src = source === 'free' ? 'free' : 'paid';
  await env.DB.prepare(
    'INSERT INTO grants (account_id, kind, amount, remaining, note, created_at, expires_at, source) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(acc.id, kind, amt, amt, note || '', Date.now(), exp, src).run();
  return { ok: true };
}

/* 改账号状态：active / disabled / pending */
export async function setStatus(env, email, status) {
  if (!['pending', 'active', 'disabled'].includes(status)) {
    return { ok: false, status: 400, message: '非法状态' };
  }
  const acc = await getAccountByEmail(env.DB, email);
  if (!acc) return { ok: false, status: 404, message: '没有这个邮箱的账号' };
  await env.DB.prepare('UPDATE accounts SET status = ? WHERE id = ?').bind(status, acc.id).run();
  return { ok: true };
}

/* 设置/取消永久免费标记（跳过用户额度扣减，站方成本照记） */
export async function setUnlimited(env, email, unlimited) {
  const acc = await getAccountByEmail(env.DB, email);
  if (!acc) return { ok: false, status: 404, message: '没有这个邮箱的账号' };
  await env.DB.prepare('UPDATE accounts SET unlimited = ? WHERE id = ?')
    .bind(unlimited ? 1 : 0, acc.id).run();
  return { ok: true };
}

/* 后台账号明细：账号 + 权益汇总（免费/付费剩余、本月成本），不返回敏感字段 */
export async function listAccountsDetailed(env, status) {
  const accounts = await listAccounts(env, status);
  const out = [];
  for (const acc of accounts) {
    let entitlements = null;
    try { entitlements = await getStatus(env, acc.id); } catch (_) {}
    out.push({
      id: acc.id, email: acc.email, status: acc.status,
      unlimited: acc.unlimited === 1,
      createdAt: acc.created_at, verifiedAt: acc.verified_at, activatedAt: acc.activated_at,
      entitlements
    });
  }
  return out;
}

/* 付费订单：线下收款登记 */
export async function createOrder(env, email, kind, units, amountCents, plan, note) {
  const acc = await getAccountByEmail(env.DB, email);
  if (!acc) return { ok: false, status: 404, message: '没有这个邮箱的账号' };
  if (!['text', 'tts'].includes(kind)) return { ok: false, status: 400, message: '类型必须是 text 或 tts' };
  const u = parseInt(units, 10);
  const c = parseInt(amountCents, 10);
  if (!Number.isSafeInteger(u) || u <= 0) return { ok: false, status: 400, message: '句数必须是正整数' };
  if (!Number.isSafeInteger(c) || c <= 0) return { ok: false, status: 400, message: '金额必须是正整数分' };
  await env.DB.prepare(
    'INSERT INTO orders (account_id, email, kind, units, amount_cents, plan, status, note, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(acc.id, email, kind, u, c, plan || '', 'pending', note || '', Date.now()).run();
  return { ok: true };
}

export async function listOrders(env) {
  const res = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all();
  return res.results;
}

/* 标记已收款 + 自动发包（幂等；发包失败回滚标记，可重试） */
export async function markOrderPaid(env, orderId) {
  const id = parseInt(orderId, 10);
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order) return { ok: false, status: 404, message: '没有这笔订单' };
  if (order.status === 'paid') return { ok: false, status: 409, message: '这笔订单已处理过' };
  const marked = await env.DB.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'")
    .bind(Date.now(), id).run();
  if (marked.meta.changes !== 1) return { ok: false, status: 409, message: '这笔订单已处理过' };
  const g = await grant(env, order.email, order.kind, order.units, '订单#' + id + ' ' + (order.plan || ''), null);
  if (!g.ok) {
    await env.DB.prepare("UPDATE orders SET status = 'pending', paid_at = NULL WHERE id = ?").bind(id).run();
    return g;
  }
  return { ok: true, granted: order.units };
}
