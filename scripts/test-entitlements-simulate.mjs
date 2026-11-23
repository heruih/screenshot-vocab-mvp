/* ============ 第一阶段权益：模拟接口四场景验证 ============
 * 用 node:sqlite 做真实 D1、内存 Map 做 KV，可控时钟模拟跨月，
 * 直接调用 Worker 的 fetch，不接任何真实外部服务、不产生真实费用。
 * 运行：node --experimental-sqlite scripts/test-entitlements-simulate.mjs
 * ===================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Script } from 'node:vm';
import worker from '../relay/english-notes-relay-worker.js';
import {
  reserveBudget, releaseBudget, settleBudget, holdBudget, resolveHold, getStatus as billingGetStatus
} from '../relay/entitlements/billing.mjs';
import { notifyOwner } from '../relay/entitlements/notify.mjs';
import { isPeakHour } from '../relay/entitlements/time.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaSql = fs.readFileSync(path.join(root, 'relay/entitlements/schema.sql'), 'utf8');

/* ---------- 可控时钟（重写全局 Date） ---------- */
const RealDate = Date;
let nowMs;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [nowMs])); }
  static now() { return nowMs; }
};
/* 设北京时间 */
function setBeijing(yyyy, mm, dd, hh = 10, mi = 0) {
  nowMs = RealDate.UTC(yyyy, mm - 1, dd, hh - 8, mi);
}

/* ---------- 内存 KV mock ---------- */
function createKV() {
  const m = new Map();
  return {
    get: async (k, options) => {
      const value = m.get(k) ?? null;
      return value !== null && options?.type === 'json' ? JSON.parse(value) : value;
    },
    put: async (k, v) => m.set(k, String(v)),
    delete: async k => m.delete(k)
  };
}

/* ---------- D1 mock（真实 SQLite） ---------- */
function createD1(sqlite) {
  return {
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        bind(...params) {
          const p = params.map(v => (v === undefined ? null : v));
          return {
            first: () => stmt.get(...p) || null,
            all: () => ({ results: stmt.all(...p) }),
            run: () => {
              const r = stmt.run(...p);
              return {
                results: [], success: true,
                meta: { changes: r.changes, lastRowId: r.lastInsertRowid, rows_read: 0, rows_written: r.changes }
              };
            }
          };
        }
      };
    }
  };
}

function makeEnv({ simMicro } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schemaSql);
  const env = {
    DB: createD1(sqlite),
    RELAY_KV: createKV(),
    ADMIN_TOKEN: 'test-admin-secret',
    BILLING_MODE: 'simulate',
    ALLOW_DEV_AUTH: '1',
    ALLOWED_ORIGIN: 'https://heruih.github.io'
  };
  if (simMicro !== undefined) env.SIMULATE_COST_MICRO = String(simMicro);
  return env;
}

/* ---------- 调用辅助 ---------- */
async function call(env, method, p, body, extra = {}) {
  const req = new Request('https://relay.example' + p, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'https://heruih.github.io', ...extra },
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  });
  const res = await worker.fetch(req, env, { waitUntil() {} });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
async function login(env, email) {
  const rc = await call(env, 'POST', '/v1/auth/request-code', { email });
  const v = await call(env, 'POST', '/v1/auth/verify', { email, code: rc.data.devCode });
  return v.data.token;
}
async function grantVoice(env, email, amount, expiresAt) {
  return call(env, 'POST', '/v1/admin/grant', { email, amount, kind: 'tts', expiresAt },
    { 'X-Admin-Token': env.ADMIN_TOKEN });
}
async function activeUser(env, email, voiceCount = 0) {
  const token = await login(env, email);
  await call(env, 'POST', '/v1/admin/activate', { email }, { 'X-Admin-Token': 'test-admin-secret' });
  if (voiceCount > 0) await grantVoice(env, email, voiceCount);
  return token;
}
const auth = token => ({ Authorization: 'Bearer ' + token });
const textBody = () => ({ messages: [{ role: 'user', content: '请生成一个口语场景' }] });
const reviewBody = (count = 1) => ({
  requestId: crypto.randomUUID(),
  answers: Array.from({ length: count }, (_, index) => ({
    target: 'try again', promptCn: '问对方能不能再试一次', attempt: 'Can we try again? ' + (index + 1)
  }))
});
const review = (env, token, body = reviewBody()) => call(env, 'POST', '/v1/dialogue/review', body, auth(token));

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}
function section(t) { console.log('\\n' + t); }

/* =========================================================
 * 场景 1：未开通（验证但未手动开通，必须被拦；开通后放行）
 * ======================================================= */
section('场景1：未开通');
setBeijing(2026, 11, 20, 10);
{
  const env = makeEnv();
  const token = await login(env, 'a1@example.com'); // 只登录不开通
  const t = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
  check('未开通 DeepSeek 返回 403', t.status === 403, 'got ' + t.status);
  check('未开通账号也不能调用新批改入口', (await review(env, token)).status === 403);
  const v = await call(env, 'POST', '/v1/tts/synthesize', { text: 'hello world' }, auth(token));
  check('未开通 CosyVoice 返回 403（前端回系统朗读）', v.status === 403, 'got ' + v.status);

  await call(env, 'POST', '/v1/admin/activate', { email: 'a1@example.com' },
    { 'X-Admin-Token': 'test-admin-secret' });
  const t2 = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
  check('手动开通后 DeepSeek 放行 200', t2.status === 200, 'got ' + t2.status);
  const noVoice = await call(env, 'POST', '/v1/tts/synthesize', { text: 'hello world' }, auth(token));
  check('开通 DeepSeek 后仍需单独发语音包', noVoice.status === 403);
  const voiceOnly = await login(env, 'voice-only@example.test');
  await grantVoice(env, 'voice-only@example.test', 1);
  const v2 = await call(env, 'POST', '/v1/tts/synthesize', { text: 'hello world' }, auth(voiceOnly));
  check('仅发独立语音包即可使用 CosyVoice', v2.status === 200 && v2.data.audio.startsWith('data:audio/mpeg'),
    'got ' + v2.status);
  const voiceOnlyText = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(voiceOnly));
  check('仅发独立语音包不开放 DeepSeek', voiceOnlyText.status === 403);
}

/* =========================================================
 * 场景 2：多人同时请求（3 账号各 12 并发，各自独立、不超额）
 * ======================================================= */
section('场景2：多人同时请求');
setBeijing(2026, 11, 21, 10);
{
  const env = makeEnv();
  const users = [];
  for (let i = 0; i < 3; i++) users.push(await activeUser(env, 'u' + i + '@example.com'));

  const results = await Promise.all(users.map(token =>
    Promise.all(Array.from({ length: 12 }, () =>
      review(env, token)))
  ));

  results.forEach((rs, i) => {
    const ok = rs.filter(r => r.status === 200).length;
    const over = rs.filter(r => r.status === 402).length;
    check('账号 u' + i + ' 恰好 10 成功 / 2 超额', ok === 10 && over === 2,
      'ok=' + ok + ' over=' + over);
  });

  for (let i = 0; i < 3; i++) {
    const st = await call(env, 'GET', '/v1/me/status', null, auth(users[i]));
    check('账号 u' + i + ' 当日计数独立为 10', st.data.entitlements.limits.text.used === 10,
      'used=' + st.data.entitlements.limits.text.used);
  }
}

/* =========================================================
 * 场景 3：跨月重置（用满后推进到下月，额度与月度成本归零）
 * ======================================================= */
section('场景3：跨月重置');
setBeijing(2026, 11, 30, 23);
{
  const env = makeEnv();
  const token = await activeUser(env, 'm@example.com');
  for (let i = 0; i < 10; i++) await review(env, token);
  const over = await review(env, token);
  check('当月第 11 句被拦 402', over.status === 402, 'got ' + over.status);
  const before = await call(env, 'GET', '/v1/me/status', null, auth(token));
  check('11 月已累计成本', before.data.entitlements.monthly.totalMicro > 0 &&
    before.data.entitlements.month === '2026-11',
    'month=' + before.data.entitlements.month);

  setBeijing(2026, 12, 1, 10); // 跨月
  const after = await call(env, 'GET', '/v1/me/status', null, auth(token));
  check('12 月当日额度重置为 0', after.data.entitlements.limits.text.used === 0 &&
    after.data.entitlements.limits.text.freeLeft === 10,
    'used=' + after.data.entitlements.limits.text.used);
  check('12 月月度成本归零', after.data.entitlements.monthly.totalMicro === 0 &&
    after.data.entitlements.month === '2026-12',
    'month=' + after.data.entitlements.month);
  const again = await review(env, token);
  check('跨月后 DeepSeek 恢复 200', again.status === 200, 'got ' + again.status);
}

/* =========================================================
 * 场景 4：硬封顶后回系统朗读（每次固定 60 元，2 次过 100，第 3 次调用前被硬拦）
 * ======================================================= */
section('场景4：硬封顶后回系统朗读');
setBeijing(2026, 11, 22, 10);
{
  const env = makeEnv({ simMicro: 60_000_000 }); // 每次固定 60 元：2 次过 100，第 3 次 60+120>150 被拦
  const token = await activeUser(env, 'cap@example.com', 3);

  const r1 = await call(env, 'POST', '/v1/tts/synthesize', { text: 'first sentence' }, auth(token));
  check('第 1 句语音放行', r1.status === 200, 'got ' + r1.status);
  const r2 = await call(env, 'POST', '/v1/tts/synthesize', { text: 'second sentence' }, auth(token));
  check('第 2 句语音放行且触发 100 元提醒', r2.status === 200 && r2.headers.get('X-Cost-Alert') === '1',
    'alert=' + r2.headers.get('X-Cost-Alert'));

  const r3 = await call(env, 'POST', '/v1/tts/synthesize', { text: 'third sentence' }, auth(token));
  check('封顶后 CosyVoice 返回 402（前端回系统朗读）', r3.status === 402, 'got ' + r3.status);
  const t3 = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
  check('封顶后 DeepSeek 同样返回 402', t3.status === 402, 'got ' + t3.status);

  setBeijing(2026, 12, 2, 10); // 下月恢复
  const r4 = await call(env, 'POST', '/v1/tts/synthesize', { text: 'next month sentence' }, auth(token));
  check('下月 CosyVoice 自动恢复 200', r4.status === 200, 'got ' + r4.status);
}

/* =========================================================
 * 场景 5：并发硬上限（复现 Codex 的"两笔同时放行"，3 笔各 80 元并发）
 * ======================================================= */
section('场景5：并发硬上限');
setBeijing(2026, 11, 23, 10);
{
  const env = makeEnv({ simMicro: 80_000_000 });
  const token = await activeUser(env, 'conc@example.com', 3);
  const rs = await Promise.all(Array.from({ length: 3 }, () =>
    call(env, 'POST', '/v1/tts/synthesize', { text: 'one sentence here' }, auth(token))));
  const ok = rs.filter(r => r.status === 200).length;
  const blocked = rs.filter(r => r.status === 402).length;
  check('3 笔并发仅 1 笔放行（80 元）、2 笔硬拦', ok === 1 && blocked === 2,
    'ok=' + ok + ' blocked=' + blocked);
  const st = await call(env, 'GET', '/v1/me/status', null, auth(token));
  const m = st.data.entitlements.monthly;
  check('账面 total 不超 150、在途预留归零', m.totalMicro === 80_000_000 &&
    m.reservedMicro === 0 && m.totalMicro <= 150_000_000,
    'total=' + m.totalMicro + ' reserved=' + m.reservedMicro);
  check('无丢账：total 恰好等于放行笔数成本', m.totalMicro === 80_000_000,
    'total=' + m.totalMicro);
}

/* =========================================================
 * 场景 6：单笔跨线在调用前拦截，且不占用户名额、不留预留
 * ======================================================= */
section('场景6：单笔跨线');
setBeijing(2026, 11, 24, 10);
{
  const env = makeEnv({ simMicro: 80_000_000 });
  const token = await activeUser(env, 'cross@example.com');
  const r1 = await review(env, token);
  check('第 1 笔 80 元放行', r1.status === 200, 'got ' + r1.status);
  const r2 = await review(env, token);
  check('第 2 笔单笔跨线（80+80>150）调用前 402', r2.status === 402, 'got ' + r2.status);
  const st = await call(env, 'GET', '/v1/me/status', null, auth(token));
  check('被拦笔不占用户名额（used 仍为 1）', st.data.entitlements.limits.text.used === 1,
    'used=' + st.data.entitlements.limits.text.used);
  check('在途预留归零、total 仍为 80', st.data.entitlements.monthly.reservedMicro === 0 &&
    st.data.entitlements.monthly.totalMicro === 80_000_000, '');
}

/* =========================================================
 * 场景 7：DeepSeek 与 CosyVoice 并发，共用同一个 150 预算
 * ======================================================= */
section('场景7：两服务并发共用预算');
setBeijing(2026, 11, 25, 10);
{
  const env = makeEnv({ simMicro: 60_000_000 });
  const token = await activeUser(env, 'both@example.com', 2);
  const [t, v] = await Promise.all([
    call(env, 'POST', '/v1/chat/completions', textBody(), auth(token)),
    call(env, 'POST', '/v1/tts/synthesize', { text: 'shared budget speech' }, auth(token))
  ]);
  check('两服务各 60 元（合计 120<=150）同时放行', t.status === 200 && v.status === 200,
    't=' + t.status + ' v=' + v.status);
  const st = await call(env, 'GET', '/v1/me/status', null, auth(token));
  check('共用一个预算 total=120', st.data.entitlements.monthly.totalMicro === 120_000_000,
    'total=' + st.data.entitlements.monthly.totalMicro);
  const [t2, v2] = await Promise.all([
    call(env, 'POST', '/v1/chat/completions', textBody(), auth(token)),
    call(env, 'POST', '/v1/tts/synthesize', { text: 'over budget now' }, auth(token))
  ]);
  check('剩余空间不足时两服务都被硬拦 402', t2.status === 402 && v2.status === 402,
    't2=' + t2.status + ' v2=' + v2.status);
}

/* =========================================================
 * 场景 8：确定失败释放 / 不确定挂起 / 人工核对闭环
 * ======================================================= */
section('场景8：失败释放、不确定挂起、人工核对');
setBeijing(2026, 11, 26, 10);
{
  const env = makeEnv({ simMicro: 50_000_000 });
  const token = await activeUser(env, 'fail@example.com');
  const accId = (await call(env, 'GET', '/v1/me/status', null, auth(token))).data.account.id;

  const b1 = await reserveBudget(env, 'text', 50_000_000);
  check('预留成功', b1.ok === true);
  await releaseBudget(env, b1);
  const s1 = await billingGetStatus(env, accId);
  check('确定失败释放后 reserved 归零、total 不变', s1.monthly.reservedMicro === 0 &&
    s1.monthly.totalMicro === 0, 'reserved=' + s1.monthly.reservedMicro);

  const b2 = await reserveBudget(env, 'tts', 50_000_000);
  await holdBudget(env, b2, 'network timeout');
  const s2 = await billingGetStatus(env, accId);
  check('不确定挂起：reserved 保留 50、budget_hold 有 1 笔', s2.monthly.reservedMicro === 50_000_000 &&
    s2.monthly.heldCount === 1, 'reserved=' + s2.monthly.reservedMicro + ' held=' + s2.monthly.heldCount);

  const r = await resolveHold(env, b2.holdId, 'settled', 40_000_000);
  check('人工核对 settled 成功', r.ok === true);
  const s3 = await billingGetStatus(env, accId);
  check('结算后 reserved=0、total 记实际 40、held 清零', s3.monthly.reservedMicro === 0 &&
    s3.monthly.totalMicro === 40_000_000 && s3.monthly.heldCount === 0,
    'total=' + s3.monthly.totalMicro);
}

/* =========================================================
 * 场景 9：100 元提醒模拟发送 + 重复请求去重
 * ======================================================= */
section('场景9：提醒模拟发送与去重');
setBeijing(2026, 11, 27, 10);
{
  const env = makeEnv();
  const payload = { subject: 's', text: 't', html: '<p>t</p>' };
  const n1 = await notifyOwner(env, 'cost-warn:2026-11', payload);
  check('首次提醒模拟发送（simulated、未去重）', n1.ok && n1.simulated === true && n1.deduped === false,
    JSON.stringify(n1));
  const n2 = await notifyOwner(env, 'cost-warn:2026-11', payload);
  check('重复请求去重（deduped=true）', n2.ok && n2.deduped === true, JSON.stringify(n2));
  const n3 = await notifyOwner(env, 'cost-warn:2026-12', payload);
  check('下月不同 key 可再次提醒', n3.deduped === false, JSON.stringify(n3));
}

/* =========================================================
 * 场景 10：北京时间跨月，在途预算与封顶按新月独立
 * ======================================================= */
section('场景10：跨月预算独立');
setBeijing(2026, 11, 30, 23);
{
  const env = makeEnv({ simMicro: 80_000_000 });
  const token = await activeUser(env, 'mm@example.com');
  const b = await reserveBudget(env, 'text', 80_000_000);
  await holdBudget(env, b, 'inconclusive before month end');
  const inFlight = await reserveBudget(env, 'tts', 60_000_000);
  const monthEnd = new Date();
  check('月末挂起 80 成功', b.ok === true);

  setBeijing(2026, 12, 1, 10); // 跨月
  const st = await call(env, 'GET', '/v1/me/status', null, auth(token));
  check('新月 total/reserved 均归零、月份为 2026-12', st.data.entitlements.monthly.totalMicro === 0 &&
    st.data.entitlements.monthly.reservedMicro === 0 && st.data.entitlements.month === '2026-12',
    JSON.stringify(st.data.entitlements.monthly));
  const r = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
  check('新月预算独立、请求放行 200', r.status === 200, 'got ' + r.status);
  await settleBudget(env, inFlight, 50_000_000);
  const admin = { 'X-Admin-Token': env.ADMIN_TOKEN };
  const attempts = await Promise.all(Array.from({ length: 2 }, () => call(env, 'POST',
    '/v1/admin/budget-holds/resolve', { holdId: b.holdId, decision: 'settled', actualMicro: 60_000_000 }, admin)));
  check('并发核对同一笔只有一次结算', attempts.map(x => x.status).sort().join() === '200,409');
  const previous = await billingGetStatus(env, st.data.account.id, monthEnd);
  const current = await billingGetStatus(env, st.data.account.id);
  check('月末预留和手动核对都记回旧月', previous.monthly.totalMicro === 110_000_000 &&
    previous.monthly.reservedMicro === 0 && current.monthly.totalMicro === 80_000_000);
}

section('场景11：旧 D1 表升级');
{
  const legacy = new DatabaseSync(':memory:');
  const baseline = schemaSql.split('-- 旧库迁移')[0].replace(/^\s*reserved_micro INTEGER.*\n/m, '');
  legacy.exec(baseline);
  legacy.exec("INSERT INTO accounts (id, email, status, created_at) VALUES (1, 'keep@example.test', 'active', 1); " +
    "INSERT INTO grants (account_id,kind,amount,remaining,created_at) VALUES (1,'text',4,2,1); " +
    "INSERT INTO monthly_cost (month,deepseek_micro,cosyvoice_micro,total_micro,alert_sent,updated_at) " +
    "VALUES ('2026-12',40000000,0,40000000,0,1)");
  legacy.exec(fs.readFileSync(path.join(root, 'relay/entitlements/migrations/001-budget-reservations.sql'), 'utf8'));
  const reviewMigration = fs.readFileSync(path.join(root, 'relay/entitlements/migrations/002-dialogue-review-receipts.sql'), 'utf8');
  legacy.exec(reviewMigration);
  legacy.exec(reviewMigration);
  const feedbackMigration = fs.readFileSync(path.join(root, 'relay/entitlements/migrations/003-feedback-inbox.sql'), 'utf8');
  legacy.exec(feedbackMigration);
  legacy.exec(feedbackMigration);
  const env = { DB: createD1(legacy) };
  const stored = await billingGetStatus(env, 1);
  check('旧费用和加练包保留，新预留为 0', stored.monthly.totalMicro === 40_000_000 &&
    stored.monthly.reservedMicro === 0 && stored.limits.text.grantRemaining === 2);
  check('旧库重复执行批改迁移无破坏', legacy.prepare('SELECT COUNT(*) AS count FROM dialogue_review_request')
    .get().count === 0 && legacy.prepare('SELECT email FROM accounts WHERE id = 1').get().email === 'keep@example.test');
  check('旧库重复执行反馈迁移无破坏', legacy.prepare('SELECT COUNT(*) AS count FROM feedback_message')
    .get().count === 0 && stored.limits.text.grantRemaining === 2);
  const budget = await reserveBudget(env, 'text', 10_000_000);
  await settleBudget(env, budget, 5_000_000);
  const latest = await billingGetStatus(env, 1);
  check('旧库升级后可预留与结算', latest.monthly.totalMicro === 45_000_000 &&
    latest.monthly.reservedMicro === 0);
}

section('场景12：真实模式的模拟上游及额度回退');
{
  const env = makeEnv();
  const token = await activeUser(env, 'provider@example.test', 1);
  env.BILLING_MODE = 'live';
  env.COSYVOICE_WORKSPACE_ID = 'ws-fixture';
  env.COSYVOICE_VOICE_ID = 'voice';
  env.COSYVOICE_API_KEY = 'fixture';
  env.DEEPSEEK_API_KEY = 'fixture';
  const upstream = globalThis.fetch;
  try {
    let outputLimit;
    globalThis.fetch = async (url, opts) => {
      outputLimit = JSON.parse(opts.body).max_tokens;
      return Response.json({ error: { message: 'mock rejection' } }, { status: 429 });
    };
    const rejected = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
    const current = await call(env, 'GET', '/v1/me/status', null, auth(token));
    check('DeepSeek 明确失败归还额度与费用预留', rejected.status === 429 &&
      current.data.entitlements.limits.text.used === 0 && current.data.entitlements.monthly.reservedMicro === 0);
    check('DeepSeek 缺省输出上限显式传给上游', outputLimit === 2048);

    globalThis.fetch = async url => {
      if (String(url).endsWith('SpeechSynthesizer')) return Response.json({
        output: { audio: { url: 'https://example.oss-cn-beijing.aliyuncs.com/mock.mp3' } }
      });
      throw new TypeError('simulated downstream connection failure');
    };
    const failed = await call(env, 'POST', '/v1/tts/synthesize', { text: 'An English sentence.' }, auth(token));
    const next = await call(env, 'GET', '/v1/me/status', null, auth(token));
    check('语音下载失败退用户额度并保留预算', failed.status === 502 &&
      next.data.entitlements.limits.tts.grantRemaining === 1 && next.data.entitlements.monthly.heldCount === 1);
    const denied = await call(env, 'POST', '/v1/admin/budget-holds', {});
    const opened = await call(env, 'POST', '/v1/admin/budget-holds', {}, { 'X-Admin-Token': env.ADMIN_TOKEN });
    check('仅管理员能读取待核对账单', denied.status === 403 && opened.data.holds.length === 1);
    const login = await call(env, 'POST', '/v1/auth/request-code', { email: 'config@example.test' });
    check('正式模式误开测试开关也不返回验证码', login.status === 500 && !login.data.devCode);
  } finally {
    globalThis.fetch = upstream;
  }
}

section('场景13：提醒发送失败后可人工重试');
{
  const env = makeEnv();
  env.BILLING_MODE = 'live';
  env.RESEND_API_KEY = 'fixture';
  env.ALERT_EMAIL = 'owner@example.test';
  const budget = await reserveBudget(env, 'text', 100_000_000);
  await settleBudget(env, budget, 100_000_000);
  const admin = { 'X-Admin-Token': env.ADMIN_TOKEN };
  const attempts = [];
  const upstream = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    attempts.push(opts.headers['Idempotency-Key']);
    return Response.json({}, { status: attempts.length === 1 ? 503 : 200 });
  };
  try {
    const endpoint = '/v1/admin/budget-alert/retry';
    const fail = await call(env, 'POST', endpoint, {}, admin);
    const sent = await call(env, 'POST', endpoint, {}, admin);
    const repeat = await call(env, 'POST', endpoint, {}, admin);
    check('失败可重试，成功后不再重发', fail.status === 502 && sent.data.pending === true &&
      sent.data.simulated === false && repeat.data.pending === false && attempts.length === 2);
    check('同账期重试沿用发送去重标识', attempts[0] === 'cost-warn:2026-12' && attempts[1] === attempts[0]);
  } finally {
    globalThis.fetch = upstream;
  }
  const page = await call(env, 'GET', '/admin', null);
  const script = page.data.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  check('后台脚本可解析并包含核对和重试入口', Boolean(script) && Boolean(new Script(script)) &&
    page.data.includes('btnResolveBudget') && page.data.includes('btnRetryAlert'));
  setBeijing(2026, 12, 1, 17, 30);
  check('工作日 17:30 计入 DeepSeek 高峰', isPeakHour());
  setBeijing(2026, 12, 1, 18);
  check('工作日 18:00 起为闲时', !isPeakHour());
}

section('场景14：配图只使用真实图片');
{
  const env = makeEnv();
  env.PIXABAY_KEY = 'test-key';
  env.ARK_API_KEY = 'stale-test-key';
  const upstream = globalThis.fetch;
  const requests = [];
  let source = 'openverse';
  globalThis.fetch = async url => {
    const host = new URL(url).hostname;
    requests.push(host);
    if (host === 'api.openverse.org') {
      return Response.json({ results: source === 'openverse' ? [{ url: 'https://example.test/open.jpg' }] : [] });
    }
    if (host === 'pixabay.com') {
      return Response.json({ hits: source === 'pixabay' ? [{ webformatURL: 'https://example.test/pixabay.jpg' }] : [] });
    }
    throw new Error('Unexpected image provider');
  };
  try {
    const endpoint = '/v1/images/generations';
    const openverse = await call(env, 'POST', endpoint, { term: 'window' });
    check('Openverse 命中时只访问 Openverse', openverse.data.source === 'openverse' &&
      requests.splice(0).join() === 'api.openverse.org');
    source = 'pixabay';
    const pixabay = await call(env, 'POST', endpoint, { term: 'window' });
    check('Openverse 缺图时回落 Pixabay', pixabay.data.source === 'pixabay' &&
      requests.splice(0).join() === 'api.openverse.org,pixabay.com');
    source = '';
    const noPhoto = await call(env, 'POST', endpoint, { term: 'window' });
    check('真实图都缺失时返回 404，旧 Key 不触发生图', noPhoto.status === 404 &&
      requests.join() === 'api.openverse.org,pixabay.com');
  } finally {
    globalThis.fetch = upstream;
  }
}

section('场景15：独立语音包余额、过期与并发');
{
  const env = makeEnv();
  const address = 'voice-pack@example.test';
  const token = await login(env, address);
  await grantVoice(env, address, 4, Date.now() - 60_000);
  const endpoint = '/v1/tts/synthesize';
  const speak = () => call(env, 'POST', endpoint, { text: 'I would like a cup of tea.' }, auth(token));
  const balance = async () => (await call(env, 'GET', '/v1/me/status', null, auth(token))).data.entitlements.limits.tts;
  check('过期语音包不放行，旧日免费语音不会补足', (await speak()).status === 403 &&
    (await balance()).freeDaily === 0);
  await grantVoice(env, address, 1);
  await grantVoice(env, address, 1);
  const concurrent = await Promise.all([speak(), speak(), speak()]);
  check('多个语音包并发只消费已发放句数', concurrent.map(r => r.status).sort().join() === '200,200,402');
  const after = await balance();
  check('语音包用完后仍显示已发放，剩余为零', after.hasPackage && after.grantRemaining === 0);
  await grantVoice(env, address, 1);
  check('追加语音包后恢复生成', (await speak()).status === 200);
}

section('场景16：自配豆包 Key 与站方计费隔离');
{
  const env = makeEnv();
  const token = await activeUser(env, 'own-key@example.test');
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, key: init.headers['X-Api-Key'], requestId: init.headers['X-Api-Request-Id'] });
    return Response.json({ code: 0, data: 'bXA=' });
  };
  try {
    const endpoint = '/v1/tts/doubao-own';
    const body = { resourceId: 'seed-tts-2.0', req_params: { text: 'Hello', speaker: 'test_speaker' } };
    const noKey = await call(env, 'POST', endpoint, body);
    const wrongOrigin = await call(env, 'POST', endpoint, body, { Origin: 'https://other.example.test',
      'X-Doubao-Key': 'test-users-key' });
    check('缺自配 Key 或来源不对均不触发上游', noKey.status === 400 && wrongOrigin.status === 403 &&
      requests.length === 0);
    const response = await call(env, 'POST', endpoint, body, { 'X-Doubao-Key': 'test-users-key' });
    check('只把用户提供的 Key 转给固定豆包地址', response.status === 200 && requests.length === 1 &&
      requests[0].key === 'test-users-key' && requests[0].requestId &&
      requests[0].url === 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    const status = await call(env, 'GET', '/v1/me/status', null, auth(token));
    check('自配 Key 不占用站方语音包及月预算', status.data.entitlements.limits.tts.grantRemaining === 0 &&
      status.data.entitlements.monthly.totalMicro === 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}


section('场景17：场景不扣批改句数、整组扣减与加练包');
setBeijing(2026, 11, 23, 10);
{
  const env = makeEnv({ simMicro: 5000 });
  const email = 'review@example.test';
  const token = await activeUser(env, email);
  setBeijing(2026, 11, 23, 10, 2); // 两次验证码间隔一分钟以上，模拟另一台设备重新登录
  const secondDevice = await login(env, email);
  const status = async (session = token) => (await call(env, 'GET', '/v1/me/status', null, auth(session))).data.entitlements;
  for (let i = 0; i < 30; i++) {
    await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
  }
  const sceneOver = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
  const before = await status();
  check('非批改请求记站方成本、享有独立日限，不扣批改', sceneOver.status === 429 &&
    before.limits.text.freeLeft === 10 && before.monthly.totalMicro === 150_000);
  const three = await review(env, token, reviewBody(3));
  check('成组收到三份反馈便扣三句，两台设备看到同一余额', three.status === 200 &&
    three.data.reviews.length === 3 && (await status(secondDevice)).limits.text.freeLeft === 7);
  await review(env, token, reviewBody(5));
  const [x, y] = await Promise.all([review(env, token, reviewBody(2)), review(env, secondDevice, reviewBody(2))]);
  const beforeOver = await status();
  check('两个设备争最后两句只放行一组，整组不拆扣', [x.status, y.status].sort().join() === '200,402' &&
    beforeOver.limits.text.used === 10 && beforeOver.monthly.reservedMicro === 0,
    JSON.stringify([x.status, y.status, beforeOver.limits.text, beforeOver.monthly]));
  const eleventh = await review(env, secondDevice);
  check('第十一句明确提示免费额度用完，不调用模型', eleventh.status === 402 &&
    eleventh.data.message.includes('10 句') && (await status()).monthly.totalMicro === beforeOver.monthly.totalMicro,
    JSON.stringify(eleventh.data));
  const admin = { 'X-Admin-Token': env.ADMIN_TOKEN };
  const grantText = (amount, expiresAt) => call(env, 'POST', '/v1/admin/grant', { email, kind: 'text', amount, expiresAt }, admin);
  await grantText(1, Date.now() + 1000);
  await grantText(1, Date.now() + 86400000);
  await grantText(3);
  setBeijing(2026, 11, 23, 11);
  const paid = await review(env, token, reviewBody(3));
  const packs = (await env.DB.prepare("SELECT remaining FROM grants WHERE kind = 'text' ORDER BY id").bind().all()).results;
  check('加练请求跳过过期包、优先用将过期包且可跨包', paid.status === 200 &&
    packs.map(pack => pack.remaining).join() === '1,0,1' && (await status()).limits.text.grantRemaining === 1);

  setBeijing(2026, 11, 24, 0);
  const tomorrow = await status();
  check('北京日界跨日恢复十句，月内累计与加练包余额保留', tomorrow.limits.text.freeLeft === 10 &&
    tomorrow.limits.text.grantRemaining === 1 && tomorrow.monthly.totalMicro === 170_000);
}

section('场景18：短时重试去重及失败回退');
setBeijing(2026, 11, 24, 10);
{
  const env = makeEnv();
  const email = 'review-retry@example.test';
  const token = await activeUser(env, email);
  const status = async () => (await call(env, 'GET', '/v1/me/status', null, auth(token))).data.entitlements;
  const two = reviewBody(2);
  const success = () => Response.json({
    choices: [{ message: { content: JSON.stringify({
      reviews: [
        { index: 2, standard: "Let's give it another try.", fit: '自然的提议', pitfalls: [] },
        { index: 1, standard: 'Could we try again?', fit: '礼貌的问句', pitfalls: [] }
      ]
    }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 }
  });
  env.BILLING_MODE = 'live';
  env.DEEPSEEK_API_KEY = 'fixture';
  const upstream = globalThis.fetch;
  try {
    let returned, started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { returned = resolve; });
    let upstreamCalls = 0;
    globalThis.fetch = async (_url, options) => {
      upstreamCalls++;
      started(JSON.parse(options.body));
      return gate;
    };
    const first = review(env, token, two);
    const bodySent = await Promise.race([startedPromise, first.then(() => null)]);
    const pending = bodySent ? await review(env, token, two) : null;
    returned(success());
    const good = await first;
    const replay = await review(env, token, two);
    const sameId = { ...two, answers: reviewBody(2).answers.map(answer => ({ ...answer, attempt: 'A different reply.' })) };
    const conflict = await review(env, token, sameId);
    check('重复点击、中途重试、成功回放合计只调用一次上游并扣两句',
      pending?.status === 409 && good.status === 200 && replay.status === 200 && upstreamCalls === 1 &&
      good.data.reviews[0].standard === 'Could we try again?' &&
      JSON.stringify(replay.data) === JSON.stringify(good.data) && (await status()).limits.text.used === 2);
    check('同一编号改答案会被拒绝，发送给模型的资料含两句', conflict.status === 409 &&
      bodySent?.response_format.type === 'json_object' && JSON.parse(bodySent.messages[1].content).answers.length === 2);
    const invalid = await review(env, token, reviewBody(0));
    check('空批次在调用上游前拒绝', invalid.status === 400 && upstreamCalls === 1);
    setBeijing(2026, 11, 24, 10, 21);
    const expired = await review(env, token, two);
    check('反馈过了短时重试窗口后不再回放，也不再次扣减', expired.status === 409 &&
      upstreamCalls === 1 && (await status()).limits.text.used === 2);

    globalThis.fetch = async () => Response.json({ error: { message: 'mock refusal' } }, { status: 429 });
    const rejected = await review(env, token, reviewBody(2));
    check('上游明确拒绝退回两句及预算预留', rejected.status === 429 && (await status()).limits.text.used === 2 &&
      (await status()).monthly.reservedMicro === 0);

    env.BILLING_MODE = 'simulate';
    await review(env, token, reviewBody(5));
    await review(env, token, reviewBody(2));
    const admin = { 'X-Admin-Token': env.ADMIN_TOKEN };
    await call(env, 'POST', '/v1/admin/grant', { email, kind: 'text', amount: 2 }, admin);
    env.BILLING_MODE = 'live';
    const before = await status();
    const mixed = reviewBody(3);
    globalThis.fetch = async () => success(); // expected 3 answers; upstream returns only 2
    const incomplete = await review(env, token, mixed);
    const afterInvalid = await status();
    check('漏批时退回整组免费和加练额度，已产生站方费用照计', incomplete.status === 502 &&
      incomplete.data.message.includes('未扣句数') && afterInvalid.limits.text.freeLeft === 1 &&
      afterInvalid.limits.text.grantRemaining === 2 && afterInvalid.monthly.totalMicro > before.monthly.totalMicro);
    globalThis.fetch = async () => { throw new DOMException('mock timeout', 'TimeoutError'); };
    const timedOut = await review(env, token, mixed);
    const afterTimeout = await status();
    check('同一编号可在失败后重试，超时返还额度并挂起待核对的站方费用',
      timedOut.status === 502 && afterTimeout.limits.text.freeLeft === 1 &&
      afterTimeout.limits.text.grantRemaining === 2 && afterTimeout.monthly.heldCount === 1);

    env.BILLING_MODE = 'simulate';
    const recovered = await review(env, token, mixed);
    const finalStatus = await status();
    check('第三次原样提交成功，恰好扣一免费句和两加练句', recovered.status === 200 &&
      finalStatus.limits.text.freeLeft === 0 && finalStatus.limits.text.grantRemaining === 0);
  } finally {
    globalThis.fetch = upstream;
  }
}


section('场景19：商业版反馈提交、去重和管理员收件箱');
setBeijing(2026, 11, 24, 10);
{
  const env = makeEnv({ simMicro: 10_000_000 });
  const email = 'feedback-user@example.test';
  const token = await login(env, email); // 已验证，尚未开通 AI
  const admin = { 'X-Admin-Token': env.ADMIN_TOKEN };
  const submit = (body, headers = auth(token)) => call(env, 'POST', '/v1/feedback', body, headers);
  const feedback = (message, allowReply = false) => ({
    requestId: crypto.randomUUID().replaceAll('-', ''), message, allowReply
  });
  const anonymous = feedback('这条不该投进收件箱');
  const noLogin = await submit(anonymous, {});
  const wrongOrigin = await submit(anonymous, { ...auth(token), Origin: 'https://another.example' });
  const badMethod = await call(env, 'GET', '/v1/feedback', null, auth(token));
  check('反馈仅允许已验证账号从站内提交', noLogin.status === 401 && wrongOrigin.status === 403 && badMethod.status === 405);
  const blank = await submit(feedback('   '));
  const long = await submit(feedback('字'.repeat(1601)));
  check('空白反馈和超长内容不入库', blank.status === 400 && long.status === 400);
  const original = feedback('在复习页加载慢\n<b>保留原文展示</b>');
  const repeat = await Promise.all([submit(original), submit(original)]);
  const edited = await submit({ ...original, message: '不同内容' });
  check('原样并发提交只入库一次，同编号变更原文被拒绝', repeat.map(r => r.status).sort().join() === '200,201' &&
    repeat.every(r => r.data.ok) && edited.status === 409);
  const withEmail = await submit(feedback('可以邮件联系我', true));
  const parallel = await Promise.all(Array.from({ length: 5 }, () => submit(feedback('稍晚的反馈'))));
  check('滚动 24 小时最多 5 条，原样重试仍能找回回执',
    withEmail.status === 201 && parallel.filter(r => r.status === 201).length === 3 &&
    parallel.filter(r => r.status === 429).length === 2 && (await submit(original)).status === 200);

  const publicList = await call(env, 'POST', '/v1/admin/feedback', {}, auth(token));
  const adminList = await call(env, 'POST', '/v1/admin/feedback', {}, admin);
  const entries = adminList.data.entries || [];
  check('只有管理员能读取真实入库的文字，最新优先', publicList.status === 403 &&
    adminList.status === 200 && adminList.headers.get('Cache-Control') === 'no-store' && entries.length === 5 &&
    entries[0].id > entries.at(-1).id && entries.at(-1).message === original.message);
  check('邮箱仅在主动勾选的单条反馈中返回', entries.filter(entry => entry.replyEmail).length === 1 &&
    entries.find(entry => entry.replyEmail)?.replyEmail === email && entries.at(-1).replyEmail === null);
  const status = await call(env, 'POST', '/v1/me/status', {}, auth(token));
  check('已验证待开通用户能反馈，无 AI 扣费且不消耗额度', status.data.account.status === 'pending' &&
    status.data.entitlements.monthly.totalMicro === 0 && status.data.entitlements.limits.text.freeLeft === 10);
  await call(env, 'POST', '/v1/admin/status', { email, status: 'disabled' }, admin);
  const disabled = await submit(feedback('停用后不可发送'));
  check('停用账号不能提交反馈', disabled.status === 403);

  const page = await call(env, 'GET', '/admin');
  const adminScript = page.data.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';
  check('管理页有收件箱，反馈内容由纯文本写入', Boolean(new Script(adminScript)) &&
    adminScript.includes('body.textContent = entry.message') && !/onclick\s*=/.test(page.data));
}

/* ---------- 汇总 ---------- */
console.log('\\n=================================');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('=================================');
process.exit(fail ? 1 : 0);
