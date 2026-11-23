/* ============ 英语笔记统一中转 Worker ============
 * 第一阶段：邮箱验证码登录 + 手动开通 + 每日免费额度（DeepSeek 10 / CosyVoice 15）
 *   + 加练包（手动发放）+ 月度成本 100 元提醒 / 150 元封顶。
 * 设计：
 *  - 绑定 D1（env.DB）即走账号权益流程；未绑定则回退旧的匿名 meter 逻辑，可平滑回滚；
 *  - BILLING_MODE=simulate（默认）走模拟上游、不真扣钱；切 live 才转发真实接口；
 *  - 密钥全部存 Secret，不回显；新功能独立存储，不碰任何已有用户数据。
 * ===================================================== */

import { normalizeEmail, requestCode, verifyCode, getSession } from './entitlements/accounts.mjs';
import {
  reserveSlot, releaseSlot, getStatus, isCapped,
  reserveBudget, settleBudget, releaseBudget, holdBudget
} from './entitlements/billing.mjs';
import { deepseekMicro, cosyvoiceMicro, maxDeepseekMicro } from './entitlements/pricing.mjs';
import { notifyOwner } from './entitlements/notify.mjs';
import { simulateText, simulateTts } from './entitlements/simulate.mjs';
import { isAdmin, listAccounts, activate, grant, setStatus } from './entitlements/admin.mjs';
import { renderAdminPage } from './entitlements/admin-page.mjs';
import { isPeakHour } from './entitlements/time.mjs';
import { synthesizeCosyVoice } from './cosyvoice-preview.mjs';

const DEEPSEEK_UPSTREAM = 'https://api.deepseek.com';
const MODEL_WHITELIST = ['deepseek-flash', 'deepseek-chat'];

/* 旧匿名通道默认档（仅在未绑定 D1 时使用） */
const DEFAULT_LIMITS = {
  text:  { daily: 15,  perMinute: 6 },
  tts:   { daily: 100, perMinute: 12 },
  image: { daily: 30,  perMinute: 6 }
};
const MAX_BODY_CHARS = 12000;
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;

const isSimulate = env => String(env.BILLING_MODE || 'simulate') !== 'live';
function fixedSimMicro(env) {
  const v = parseInt(env.SIMULATE_COST_MICRO, 10);
  return Number.isSafeInteger(v) && v >= 0 ? v : null;
}

function originAllowed(origin, allowed) {
  return !origin || origin === allowed || origin === 'null' || /^sitecase:\/\//i.test(origin);
}
function cors(origin, allowed) {
  const value = origin && originAllowed(origin, allowed) ? origin : allowed;
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, Authorization, X-Admin-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
function jerr(status, message, headers) {
  return new Response(JSON.stringify({ code: status, message }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}
function jbody(status, obj, headers, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', ...extra }
  });
}
async function readJson(request) {
  try { return await request.json(); } catch (_) { return null; }
}
function bearerToken(request) {
  const v = request.headers.get('Authorization') || '';
  return v.startsWith('Bearer ') ? v.slice(7).trim() : '';
}

/* ---------- 旧匿名通道逻辑（无 D1 时保留，含图片） ---------- */

function limitsFor(env, kind) {
  const base = Object.assign({}, DEFAULT_LIMITS[kind] || DEFAULT_LIMITS.text);
  try {
    const raw = env.RELAY_LIMITS ? JSON.parse(env.RELAY_LIMITS) : null;
    if (raw && raw[kind]) Object.assign(base, raw[kind]);
  } catch (_) {}
  return base;
}
function ymd(d) {
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
}
function deviceIdOf(request) {
  const v = request.headers.get('X-Device-Id') || '';
  if (DEVICE_RE.test(v)) return v;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
  return 'ip' + Math.abs(h).toString(36);
}
async function meter(env, ctx, device, kind) {
  const lim = limitsFor(env, kind);
  const kv = env.RELAY_KV;
  const day = ymd(new Date());
  const now = new Date();
  const minute = day + String(now.getUTCHours()).padStart(2, '0') + String(now.getUTCMinutes()).padStart(2, '0');
  const rlKey = 'rl:' + kind + ':' + device + ':' + minute;
  const dayKey = 'd:' + kind + ':' + device + ':' + day;
  if (!kv) return { blocked: false, daily: 0, limit: lim.daily, perMinute: 0, degraded: true };

  const rlRaw = parseInt((await kv.get(rlKey)) || '0', 10) || 0;
  if (rlRaw >= lim.perMinute) {
    return { blocked: true, daily: 0, limit: lim.daily, perMinute: rlRaw, retryAfter: 20 };
  }
  const dayRec = (await kv.get(dayKey, { type: 'json' })) || { count: 0, tier: 'free', first: Date.now() };
  dayRec.count += 1;
  dayRec.last = Date.now();
  if (!dayRec.tier) dayRec.tier = 'free';

  ctx.waitUntil(kv.put(rlKey, String(rlRaw + 1), { expirationTtl: 120 }));
  ctx.waitUntil(kv.put(dayKey, JSON.stringify(dayRec), { expirationTtl: 60 * 60 * 48 }));

  const enforce = String(env.ENFORCE_DAILY || '') === '1';
  return {
    blocked: enforce && dayRec.count > lim.daily,
    daily: dayRec.count, limit: lim.daily, perMinute: rlRaw + 1,
    tier: dayRec.tier, retryAfter: 60
  };
}

/* ---------- 入口路由 ---------- */

export default {
  async fetch(request, env, ctx) {
    const allowed = env.ALLOWED_ORIGIN || 'https://heruih.github.io';
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin, allowed);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    /* 极简管理页面（浏览器直接访问，无需 Origin） */
    if (path === '/admin') {
      return new Response(renderAdminPage(), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    /* 账号认证 */
    if (path === '/v1/auth/request-code') return handleRequestCode(request, env, headers);
    if (path === '/v1/auth/verify') return handleVerify(request, env, headers);

    /* 账号权益（需 D1） */
    if (path === '/v1/me/status') return handleMeStatus(request, env, headers);
    if (path === '/v1/tts/synthesize') return handleTts(request, env, headers, ctx);
    if (path === '/v1/chat/completions') {
      return env.DB ? handleTextEntitled(request, env, headers, ctx) : handleTextLegacy(request, env, ctx, headers);
    }

    /* 管理员（需 D1） */
    if (path === '/v1/admin/accounts') return handleAdminAccounts(request, env, headers);
    if (path === '/v1/admin/activate') return handleAdminActivate(request, env, headers);
    if (path === '/v1/admin/grant') return handleAdminGrant(request, env, headers);
    if (path === '/v1/admin/status') return handleAdminStatus(request, env, headers);

    /* 图片沿用旧逻辑 */
    if (path === '/v1/images/generations') return handleImage(request, env, ctx, headers);

    if (request.method !== 'POST' && request.method !== 'GET') return jerr(405, 'Method Not Allowed', headers);
    if (!originAllowed(origin, allowed)) return jerr(403, 'Origin Not Allowed', headers);
    return jerr(404, 'Unknown path', headers);
  }
};

/* ---------- 认证处理 ---------- */

async function handleRequestCode(request, env, headers) {
  const input = await readJson(request);
  const email = normalizeEmail(input && input.email);
  if (!email) return jerr(400, '邮箱格式不正确', headers);
  const result = await requestCode(env, email);
  if (!result.ok) return jerr(result.status, result.message, headers);
  return jbody(200, { ok: true, simulate: !!result.simulate, devCode: result.devCode }, headers);
}

async function handleVerify(request, env, headers) {
  const input = await readJson(request);
  const email = normalizeEmail(input && input.email);
  if (!email) return jerr(400, '邮箱格式不正确', headers);
  const result = await verifyCode(env, email, input && input.code);
  if (!result.ok) return jerr(result.status, result.message, headers);
  return jbody(200, { ok: true, token: result.token, account: publicAccount(result.account) }, headers);
}

async function handleMeStatus(request, env, headers) {
  const account = await getSession(env, bearerToken(request));
  if (!account) return jerr(401, '登录已失效，请重新登录', headers);
  const status = await getStatus(env, account.id);
  return jbody(200, { account: publicAccount(account), entitlements: status }, headers);
}

function publicAccount(acc) {
  return {
    id: acc.id, email: acc.email, status: acc.status,
    createdAt: acc.created_at, verifiedAt: acc.verified_at, activatedAt: acc.activated_at
  };
}

/* ---------- 账号权益：DeepSeek 文本 ---------- */

async function handleTextEntitled(request, env, headers, ctx) {
  const account = await getSession(env, bearerToken(request));
  if (!account) return jerr(401, '请先登录', headers);
  if (account.status === 'disabled') return jerr(403, '账号已停用', headers);
  if (account.status !== 'active') return jerr(403, '邮箱已验证，等待站方开通', headers);

  const input = await readJson(request);
  if (!input || !Array.isArray(input.messages) || !input.messages.length) {
    return jerr(400, '缺少 messages', headers);
  }
  if (JSON.stringify(input.messages).length > MAX_BODY_CHARS) {
    return jerr(413, '输入过长，请缩短后再试', headers);
  }
  if (await isCapped(env)) {
    return jerr(402, '站方本月服务额度已封顶，下月自动恢复；可填自己的 Key 继续', headers);
  }

  /* 1) 先按最高可能成本原子预留站方预算；失败即封顶，不调上游、不占用户名额 */
  const fixedForMax = fixedSimMicro(env);
  const maxMicro = fixedForMax !== null ? fixedForMax : maxDeepseekMicro(env, input);
  const budget = await reserveBudget(env, 'text', maxMicro);
  if (!budget.ok) {
    return jerr(402, '站方本月服务额度已封顶，下月自动恢复；可填自己的 Key 继续', headers);
  }

  /* 2) 再原子占用户练习名额；没抢到就把刚预留的预算退掉 */
  const reservation = await reserveSlot(env, account.id, 'text');
  if (reservation.source === 'none') {
    await releaseBudget(env, maxMicro);
    return jerr(402, '今日免费句数已用完，可使用加练包或填自己的 Key', headers);
  }

  try {
    let data, usage;
    if (isSimulate(env)) {
      const sim = simulateText(input);
      data = sim.response; usage = sim.usage;
    } else {
      const r = await callDeepseekUpstream(env, input);
      if (!r.ok) {
        /* 上游明确错误响应：确定未扣费，释放预算 + 归还用户名额 */
        await releaseBudget(env, maxMicro);
        await releaseSlot(env, account.id, 'text', reservation);
        return jerr(r.status, r.message, headers);
      }
      data = r.data; usage = r.usage;
    }

    /* 3) 成功：按实际用量结算，退回多预留差额；首次跨 100 线则主动通知站方 */
    const fixed = fixedSimMicro(env);
    const actualMicro = fixed !== null ? fixed : deepseekMicro(env, usage, isPeakHour());
    const cost = await settleBudget(env, 'text', maxMicro, actualMicro);
    if (cost.alert) scheduleCostWarning(env, ctx, cost);
    return jbody(200, data, headers, costHeaders(cost, reservation));
  } catch (err) {
    /* 只有网络层异常（超时/连接失败）会到这里：上游是否扣费不确定，挂起预留待核对；
     * 用户没拿到结果，仍归还其练习名额。 */
    await holdBudget(env, budget.holdId, 'text', maxMicro, err.message);
    await releaseSlot(env, account.id, 'text', reservation);
    return jerr(502, 'AI 服务暂不可用，请稍后再试', headers);
  }
}

/* live 模式调用 DeepSeek：网络层异常直接抛出（调用方按"不确定"挂起）；
 * 有明确 HTTP 响应则返回 {ok,status,message} 或 {ok,data,usage}。 */
async function callDeepseekUpstream(env, input) {
  let model = MODEL_WHITELIST.includes(input.model) ? input.model : MODEL_WHITELIST[0];
  if (env.DEEPSEEK_MODEL) model = env.DEEPSEEK_MODEL;
  const upstreamBody = {
    model,
    temperature: typeof input.temperature === 'number' ? input.temperature : 0.85,
    messages: input.messages
  };
  if (input.max_tokens) upstreamBody.max_tokens = input.max_tokens;
  if (input.response_format) upstreamBody.response_format = input.response_format;
  const upstream = await fetch(DEEPSEEK_UPSTREAM + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
    body: JSON.stringify(upstreamBody)
  });
  const text = await upstream.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
  if (!upstream.ok) {
    return { ok: false, status: upstream.status, message: (parsed && parsed.error && parsed.error.message) || '上游服务异常' };
  }
  return { ok: true, data: parsed, usage: parsed.usage || {} };
}

/* 首次跨 100 元提醒线：异步主动通知站方，不阻塞响应；失败不影响主流程。 */
function scheduleCostWarning(env, ctx, cost) {
  const yuan = (cost.total / 1_000_000).toFixed(2);
  const subject = '【截图错题本】本月站方费用已达 100 元提醒线';
  const text = '账期 ' + cost.month + '，站方累计成本已达 100 元（当前 ' + yuan +
    ' 元），150 元为硬封顶，达到后付费功能自动停用。';
  const job = notifyOwner(env, 'cost-warn:' + cost.month,
    { subject, text, html: '<p>' + text + '</p>' }).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
}

/* ---------- 账号权益：CosyVoice 语音 ---------- */

async function handleTts(request, env, headers, ctx) {
  const account = await getSession(env, bearerToken(request));
  if (!account) return jerr(401, '请先登录', headers);
  if (account.status !== 'active') {
    /* 未开通/停用：前端据此回系统朗读 */
    return jerr(403, '站方语音未开通，已使用系统朗读', headers);
  }
  const input = await readJson(request);
  const text = String(input && input.text || '').trim();
  if (!text) return jerr(400, '缺少 text', headers);
  if (Array.from(text).length > 240) return jerr(422, '请选择 240 字符以内的内容朗读', headers);

  if (await isCapped(env)) {
    return jerr(402, '站方本月语音额度已封顶，已使用系统朗读', headers);
  }

  /* 输入字符数已知，按它原子预留（CosyVoice 按输入字符计费） */
  const fixedForMax = fixedSimMicro(env);
  const maxMicro = fixedForMax !== null ? fixedForMax : cosyvoiceMicro(env, Array.from(text).length);
  const budget = await reserveBudget(env, 'tts', maxMicro);
  if (!budget.ok) {
    return jerr(402, '站方本月语音额度已封顶，已使用系统朗读', headers);
  }
  const reservation = await reserveSlot(env, account.id, 'tts');
  if (reservation.source === 'none') {
    await releaseBudget(env, maxMicro);
    return jerr(402, '今日站方语音句数已用完，已使用系统朗读', headers);
  }

  try {
    let audio, characters;
    if (isSimulate(env)) {
      const sim = simulateTts(text);
      audio = sim.audio; characters = sim.characters;
    } else {
      const result = await synthesizeCosyVoice(text, {
        workspaceId: env.COSYVOICE_WORKSPACE_ID,
        voiceId: env.COSYVOICE_VOICE_ID,
        apiKey: env.COSYVOICE_API_KEY
      });
      let bin = '';
      for (const b of result.bytes) bin += String.fromCharCode(b);
      audio = 'data:audio/mpeg;base64,' + btoa(bin);
      characters = result.characters;
    }

    const fixed = fixedSimMicro(env);
    const actualMicro = fixed !== null ? fixed : cosyvoiceMicro(env, characters);
    const cost = await settleBudget(env, 'tts', maxMicro, actualMicro);
    if (cost.alert) scheduleCostWarning(env, ctx, cost);
    return jbody(200, { audio, characters }, headers, costHeaders(cost, reservation));
  } catch (err) {
    /* 不确定（超时/网络/合成后失败）挂起；配置错误或明确拒绝则释放 */
    if (err && err.name === 'TtsError' && err.kind === 'inconclusive') {
      await holdBudget(env, budget.holdId, 'tts', maxMicro, err.message);
    } else {
      await releaseBudget(env, maxMicro);
    }
    await releaseSlot(env, account.id, 'tts', reservation);
    return jerr(502, '站方语音暂不可用，已使用系统朗读', headers);
  }
}

function costHeaders(cost, reservation) {
  return {
    'X-Cost-Alert': cost.alert ? '1' : '0',
    'X-Monthly-Cost-Micro': String(cost.total),
    'X-Entitlements-Source': reservation.source
  };
}

/* ---------- 管理员处理 ---------- */

function adminTokenOf(request) {
  return request.headers.get('X-Admin-Token') || '';
}
async function handleAdminAccounts(request, env, headers) {
  if (!env.DB) return jerr(500, '账号服务未配置', headers);
  if (!isAdmin(env, adminTokenOf(request))) return jerr(403, '管理员密钥无效', headers);
  const input = await readJson(request);
  const accounts = await listAccounts(env, input && input.status);
  return jbody(200, { accounts: accounts.map(publicAccount) }, headers);
}
async function handleAdminActivate(request, env, headers) {
  if (!isAdmin(env, adminTokenOf(request))) return jerr(403, '管理员密钥无效', headers);
  const input = await readJson(request);
  const result = await activate(env, normalizeEmail(input && input.email));
  if (!result.ok) return jerr(result.status, result.message, headers);
  return jbody(200, { ok: true, account: publicAccount(result.account) }, headers);
}
async function handleAdminGrant(request, env, headers) {
  if (!isAdmin(env, adminTokenOf(request))) return jerr(403, '管理员密钥无效', headers);
  const input = await readJson(request);
  const result = await grant(env, normalizeEmail(input && input.email), input.kind,
    input.amount, input.note, input.expiresAt);
  if (!result.ok) return jerr(result.status, result.message, headers);
  return jbody(200, { ok: true }, headers);
}
async function handleAdminStatus(request, env, headers) {
  if (!isAdmin(env, adminTokenOf(request))) return jerr(403, '管理员密钥无效', headers);
  const input = await readJson(request);
  const result = await setStatus(env, normalizeEmail(input && input.email), input.status);
  if (!result.ok) return jerr(result.status, result.message, headers);
  return jbody(200, { ok: true }, headers);
}

/* ---------- 旧匿名 DeepSeek（无 D1 时） ---------- */

async function handleTextLegacy(request, env, ctx, headers) {
  if (!env.DEEPSEEK_API_KEY) return jerr(500, 'DEEPSEEK_API_KEY 未配置', headers);
  const input = await readJson(request);
  if (!input || !Array.isArray(input.messages) || !input.messages.length) {
    return jerr(400, '缺少 messages', headers);
  }
  if (JSON.stringify(input.messages).length > MAX_BODY_CHARS) {
    return jerr(413, '输入过长，请缩短后再试', headers);
  }
  const device = deviceIdOf(request);
  const m = await meter(env, ctx, device, 'text');
  if (m.blocked) return jerr(429, '请求太频繁，稍后再试', { ...headers, 'Retry-After': String(m.retryAfter || 20) });

  let model = MODEL_WHITELIST.includes(input.model) ? input.model : MODEL_WHITELIST[0];
  if (env.DEEPSEEK_MODEL) model = env.DEEPSEEK_MODEL;
  const upstreamBody = {
    model,
    temperature: typeof input.temperature === 'number' ? input.temperature : 0.85,
    messages: input.messages
  };
  if (input.max_tokens) upstreamBody.max_tokens = input.max_tokens;
  if (input.response_format) upstreamBody.response_format = input.response_format;

  const upstream = await fetch(DEEPSEEK_UPSTREAM + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
    body: JSON.stringify(upstreamBody)
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      ...headers,
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'X-Relay-Tier': m.tier || 'free',
      'X-Relay-Daily-Count': String(m.daily || 0),
      'X-Relay-Daily-Limit': String(m.limit || 0),
      'X-Relay-Degraded': m.degraded ? '1' : '0'
    }
  });
}

/* ================= 图片 relay：Openverse → Pixabay → Seedream 接力 ================= */
const IMG_TIMEOUT = 8000;
function imgSignal() {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), IMG_TIMEOUT);
  return ctrl.signal;
}
async function wOpenverse(term) {
  try {
    const res = await fetch(
      'https://api.openverse.org/v1/images/?page_size=12&mature=false&license_type=commercial&q=' + encodeURIComponent(term),
      { signal: imgSignal() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(r => ({
      thumb: r.thumbnail || r.url || '',
      src: r.url || r.thumbnail || '',
      big: r.url || '',
      page: r.foreign_landing_url || '',
      credit: (r.creator ? ('Photo by ' + r.creator + ' · ') : '') + 'Openverse / ' + (r.license || 'CC')
    })).filter(x => x.thumb);
  } catch (_) { return []; }
}
async function wPixabay(term, key) {
  try {
    const res = await fetch(
      'https://pixabay.com/api/?key=' + encodeURIComponent(key) +
        '&q=' + encodeURIComponent(term) +
        '&image_type=photo&orientation=horizontal&safesearch=true&order=popular&per_page=12&lang=en',
      { signal: imgSignal() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.hits || []).map(h => ({
      thumb: h.webformatURL || h.previewURL || '',
      src: h.webformatURL || h.previewURL || '',
      big: h.largeImageURL || h.webformatURL || '',
      page: h.pageURL || '',
      credit: 'Photo by ' + (h.user || 'Pixabay') + ' · Pixabay'
    })).filter(x => x.thumb);
  } catch (_) { return []; }
}
async function wSeedream(term, context, env) {
  try {
    const prompt = '为英语表达「' + term + '」生成一张帮助记忆的学习插图。语境：' + (context || '日常真实使用场景') +
      '。只表现一个自然动作和一个关键物件，画面干净具体，不要出现任何文字、字幕、水印。';
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.ARK_API_KEY },
      body: JSON.stringify({
        model: env.SEEDREAM_MODEL || 'doubao-seedream-5-0-flash-260915',
        prompt, size: '1024x1024', watermark: false, response_format: 'url'
      })
    });
    const txt = await res.text();
    if (!res.ok) return { __error: 'seedream HTTP ' + res.status + ' => ' + txt.slice(0, 600) };
    const data = JSON.parse(txt);
    const items = (data.data || []).map(it => ({
      thumb: it.url || '', src: it.url || '', big: it.url || '',
      credit: 'AI 生成 · Seedream', ai: true
    })).filter(x => x.src);
    return { items };
  } catch (e) {
    return { __error: 'seedream exception: ' + (e.name || '') + ' ' + (e.message || '') };
  }
}
async function handleImage(request, env, ctx, headers) {
  const input = await readJson(request);
  const term = String(input && input.term || '').trim();
  if (!term) return jerr(400, '缺少 term', headers);

  const device = deviceIdOf(request);
  const m = await meter(env, ctx, device, 'image');
  if (m.blocked) {
    return jerr(429, '请求太频繁，稍后再试', { ...headers, 'Retry-After': String(m.retryAfter || 20) });
  }

  let candidates = await wOpenverse(term);
  let source = candidates.length ? 'openverse' : '';
  if (!candidates.length && env.PIXABAY_KEY) {
    candidates = await wPixabay(term, env.PIXABAY_KEY);
    if (candidates.length) source = 'pixabay';
  }
  let seedreamError = '';
  if (!candidates.length && env.ARK_API_KEY) {
    const sr = await wSeedream(term, String(input.context || ''), env);
    if (sr && sr.__error) seedreamError = sr.__error;
    else if (sr && Array.isArray(sr.items) && sr.items.length) {
      candidates = sr.items; source = 'seedream';
    }
  }
  if (!candidates.length) {
    return jerr(404, '所有配图源都没返回图' + (seedreamError ? '；' + seedreamError : ''), headers);
  }
  const out = {
    source, term,
    candidates: candidates.slice(0, 6),
    usage: { daily: m.daily, limit: m.limit, tier: m.tier || 'free', degraded: !!m.degraded }
  };
  return new Response(JSON.stringify(out), {
    status: 200,
    headers: {
      ...headers, 'Content-Type': 'application/json',
      'X-Relay-Tier': m.tier || 'free',
      'X-Relay-Daily-Count': String(m.daily || 0),
      'X-Relay-Daily-Limit': String(m.limit || 0),
      'X-Relay-Degraded': m.degraded ? '1' : '0'
    }
  });
}
