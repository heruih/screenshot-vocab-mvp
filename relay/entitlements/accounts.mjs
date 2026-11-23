/* ============ 账号 / 验证码 / 会话 ============
 * 验证码与会话用 KV（带 TTL 自动过期），长期账号资料用 D1。
 * 真机配置了 RESEND_API_KEY 就真发邮件；未配置时返回 devCode，仅供本地/测试。
 * ============================================ */

import { sendCodeEmail } from './mailer.mjs';

const CODE_TTL = 10 * 60;                  // 验证码 10 分钟
const SESSION_TTL = 30 * 24 * 60 * 60;     // 会话 30 天
const RESEND_INTERVAL = 60;                // 同邮箱两次发信最小间隔（秒）
const MAX_CODE_ATTEMPTS = 5;                // 验证码最多错误次数

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  const v = String(email || '').trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : '';
}

function randomCode() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, '0');
}
function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/* 请求发送验证码 */
export async function requestCode(env, email) {
  const kv = env.RELAY_KV;
  if (kv) {
    const last = parseInt((await kv.get('coderate:' + email)) || '0', 10) || 0;
    if (last && Date.now() - last < RESEND_INTERVAL * 1000) {
      return { ok: false, status: 429, message: '验证码发送太频繁，请稍后再试' };
    }
  }
  const code = randomCode();
  if (kv) {
    await kv.put('code:' + email, JSON.stringify({ code, attempts: 0, at: Date.now() }),
      { expirationTtl: CODE_TTL });
    await kv.put('coderate:' + email, String(Date.now()), { expirationTtl: RESEND_INTERVAL });
  }

  if (env.RESEND_API_KEY) {
    await sendCodeEmail(env, email, code);
    return { ok: true };
  }
  /* 生产环境必须能真实发邮件；只有显式打开隔离测试开关 ALLOW_DEV_AUTH 时才回传验证码，
   * 确保验证码不会在正式环境泄露到响应里。 */
  if (String(env.ALLOW_DEV_AUTH) === '1') {
    return { ok: true, simulate: true, devCode: code };
  }
  return { ok: false, status: 500, message: '邮件服务未配置，暂时无法发送验证码' };
}

/* 校验验证码，建立/取回账号并签发会话 */
export async function verifyCode(env, email, code) {
  const db = env.DB;
  const kv = env.RELAY_KV;
  if (!db) return { ok: false, status: 500, message: '账号服务未配置' };

  const rec = kv ? JSON.parse((await kv.get('code:' + email)) || 'null') : null;
  if (!rec) return { ok: false, status: 400, message: '验证码已过期，请重新获取' };
  if (rec.attempts >= MAX_CODE_ATTEMPTS) {
    await kv.delete('code:' + email);
    return { ok: false, status: 429, message: '尝试次数过多，请重新获取验证码' };
  }
  if (String(rec.code) !== String(code)) {
    rec.attempts += 1;
    await kv.put('code:' + email, JSON.stringify(rec), { expirationTtl: CODE_TTL });
    return { ok: false, status: 401, message: '验证码不正确' };
  }
  await kv.delete('code:' + email);

  const now = Date.now();
  /* 幂等建号：同邮箱并发时只有一个插入成功，再统一读回 */
  await db.prepare(
    "INSERT OR IGNORE INTO accounts (email, status, created_at, verified_at) VALUES (?, 'pending', ?, ?)"
  ).bind(email, now, now).run();
  let account = await getAccountByEmail(db, email);
  if (!account.verified_at) {
    await db.prepare('UPDATE accounts SET verified_at = ? WHERE id = ?').bind(now, account.id).run();
    account.verified_at = now;
  }

  const token = randomToken();
  if (kv) {
    await kv.put('sess:' + token, JSON.stringify({ id: account.id, email }),
      { expirationTtl: SESSION_TTL });
  }
  return { ok: true, token, account };
}

/* 用会话令牌取回账号；无效或过期返回 null */
export async function getSession(env, token) {
  if (!token || !env.RELAY_KV || !env.DB) return null;
  const rec = JSON.parse((await env.RELAY_KV.get('sess:' + token)) || 'null');
  if (!rec || !rec.id) return null;
  return getAccountById(env.DB, rec.id);
}

export async function getAccountByEmail(db, email) {
  if (!db) return null;
  const row = await db.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
  return row || null;
}

export async function getAccountById(db, id) {
  if (!db) return null;
  const row = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  return row || null;
}
