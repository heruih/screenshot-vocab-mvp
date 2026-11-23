/* ============ 第一阶段权益：模拟接口四场景验证 ============
 * 用 node:sqlite 做真实 D1、内存 Map 做 KV，可控时钟模拟跨月，
 * 直接调用 Worker 的 fetch，不接任何真实外部服务、不产生真实费用。
 * 运行：node --experimental-sqlite scripts/test-entitlements-simulate.mjs
 * ===================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../relay/english-notes-relay-worker.js';

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
    get: async k => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => m.set(k, String(v)),
    delete: async k => m.delete(k)
  };
}

/* ---------- D1 mock（真实 SQLite） ---------- */
function createD1(sqlite) {
  return {
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
async function activeUser(env, email) {
  const token = await login(env, email);
  await call(env, 'POST', '/v1/admin/activate', { email }, { 'X-Admin-Token': 'test-admin-secret' });
  return token;
}
const auth = token => ({ Authorization: 'Bearer ' + token });
const textBody = () => ({ messages: [{ role: 'user', content: '请生成一个口语场景' }] });

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
  const v = await call(env, 'POST', '/v1/tts/synthesize', { text: 'hello world' }, auth(token));
  check('未开通 CosyVoice 返回 403（前端回系统朗读）', v.status === 403, 'got ' + v.status);

  await call(env, 'POST', '/v1/admin/activate', { email: 'a1@example.com' },
    { 'X-Admin-Token': 'test-admin-secret' });
  const t2 = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
  check('手动开通后 DeepSeek 放行 200', t2.status === 200, 'got ' + t2.status);
  const v2 = await call(env, 'POST', '/v1/tts/synthesize', { text: 'hello world' }, auth(token));
  check('手动开通后 CosyVoice 放行 200', v2.status === 200 && v2.data.audio.startsWith('data:audio/mpeg'),
    'got ' + v2.status);
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
      call(env, 'POST', '/v1/chat/completions', textBody(), auth(token))))
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
  for (let i = 0; i < 10; i++) await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
  const over = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
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
  const again = await call(env, 'POST', '/v1/chat/completions', textBody(), auth(token));
  check('跨月后 DeepSeek 恢复 200', again.status === 200, 'got ' + again.status);
}

/* =========================================================
 * 场景 4：封顶后回系统朗读（每次固定 8000 分，推过 15000）
 * ======================================================= */
section('场景4：封顶后回系统朗读');
setBeijing(2026, 11, 22, 10);
{
  const env = makeEnv({ simMicro: 80_000_000 }); // 每次固定 80 元，2 次过 100、逼近 150
  const token = await activeUser(env, 'cap@example.com');

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

/* ---------- 汇总 ---------- */
console.log('\\n=================================');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('=================================');
process.exit(fail ? 1 : 0);
