/* ============ 英语笔记统一中转 Worker（先做文本，图片路由预留） ============
 * 设计：
 *  - Key 全部存 Secret，前端不填 Key 也能用；
 *  - 速率限制（每分钟）硬拦截，防瞬间刷量；每日额度当前只计数、不拦截，tier 预留；
 *  - 设备 id 由前端生成、独立 key 保存，通过 X-Device-Id 传入；
 *  - KV 未绑定时自动降级为只转发、不限流，保证可平滑部署；
 *  - 不回显任何密钥。
 * ====================================================================== */

const DEEPSEEK_UPSTREAM = 'https://api.deepseek.com';
const MODEL_WHITELIST = ['deepseek-flash', 'deepseek-chat'];

/* 默认免费档（后台可用同名 env 变量覆盖整段 JSON） */
const DEFAULT_LIMITS = {
  text:  { daily: 15,  perMinute: 6 },
  tts:   { daily: 100, perMinute: 12 },
  image: { daily: 30,  perMinute: 6 }
};
/* 输入体保护：防止超大 prompt 刷 token */
const MAX_BODY_CHARS = 12000;
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;

function originAllowed(origin, allowed) {
  return !origin || origin === allowed || origin === 'null' || /^sitecase:\/\//i.test(origin);
}
function cors(origin, allowed) {
  const value = origin && originAllowed(origin, allowed) ? origin : allowed;
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id',
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
  /* 兜底：用对端地址哈希，NAT 下会共享，仅作防刷，不做精确计量 */
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
  return 'ip' + Math.abs(h).toString(36);
}

/* 速率限制 + 每日计数。返回 {blocked, daily, perMinute, meta} */
async function meter(env, ctx, device, kind) {
  const lim = limitsFor(env, kind);
  const kv = env.RELAY_KV;
  const day = ymd(new Date());
  const minute = day + String(new Date().getUTCHours()).padStart(2, '0') + String(new Date().getUTCMinutes()).padStart(2, '0');
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
  /* tier 预留：当前固定 free；未来按 tier 决定是否硬拦每日额度 */
  if (!dayRec.tier) dayRec.tier = 'free';

  ctx.waitUntil(kv.put(rlKey, String(rlRaw + 1), { expirationTtl: 120 }));
  ctx.waitUntil(kv.put(dayKey, JSON.stringify(dayRec), { expirationTtl: 60 * 60 * 48 }));

  /* 现在全免费：每日额度只计数，不拦截。预留 ENFORCE_DAILY 开关。 */
  const enforce = String(env.ENFORCE_DAILY || '') === '1';
  const overDaily = enforce && dayRec.count > lim.daily;
  return {
    blocked: overDaily,
    daily: dayRec.count,
    limit: lim.daily,
    perMinute: rlRaw + 1,
    tier: dayRec.tier,
    retryAfter: 60
  };
}

export default {
  async fetch(request, env, ctx) {
    const allowed = env.ALLOWED_ORIGIN || 'https://heruih.github.io';
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin, allowed);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return jerr(405, 'Method Not Allowed', headers);
    if (!originAllowed(origin, allowed)) return jerr(403, 'Origin Not Allowed', headers);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/v1/chat/completions') return handleText(request, env, ctx, headers);
    /* 图片 relay 在 #103 接入，先明确返回未启用 */
    if (path === '/v1/images/generations') return handleImage(request, env, ctx, headers);
    return jerr(404, 'Unknown path', headers);
  }
};

async function handleText(request, env, ctx, headers) {
  if (!env.DEEPSEEK_API_KEY) return jerr(500, 'DEEPSEEK_API_KEY 未配置', headers);

  let input;
  try { input = await request.json(); } catch (_) {
    return jerr(400, '请求 JSON 无效', headers);
  }
  if (!input || !Array.isArray(input.messages) || !input.messages.length) {
    return jerr(400, '缺少 messages', headers);
  }
  const rawLen = JSON.stringify(input.messages).length;
  if (rawLen > MAX_BODY_CHARS) return jerr(413, '输入过长，请缩短后再试', headers);

  const device = deviceIdOf(request);
  const m = await meter(env, ctx, device, 'text');
  if (m.blocked) {
    const h = { ...headers, 'Retry-After': String(m.retryAfter || 20) };
    return jerr(429, '请求太频繁，稍后再试', h);
  }

  /* model 白名单：默认 flash，前端传非法值一律回退 flash，保证成本可控 */
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
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.DEEPSEEK_API_KEY
    },
    body: JSON.stringify(upstreamBody)
  });
  const body = await upstream.text();
  const outHeaders = {
    ...headers,
    'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    'X-Relay-Tier': m.tier || 'free',
    'X-Relay-Daily-Count': String(m.daily || 0),
    'X-Relay-Daily-Limit': String(m.limit || 0),
    'X-Relay-Degraded': m.degraded ? '1' : '0'
  };
  return new Response(body, { status: upstream.status, headers: outHeaders });
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
    const url = 'https://api.openverse.org/v1/images/?page_size=12&mature=false&license_type=commercial&q=' + encodeURIComponent(term);
    const res = await fetch(url, { signal: imgSignal() });
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
    const url = 'https://pixabay.com/api/?key=' + encodeURIComponent(key)
      + '&q=' + encodeURIComponent(term)
      + '&image_type=photo&orientation=horizontal&safesearch=true&order=popular&per_page=12&lang=en';
    const res = await fetch(url, { signal: imgSignal() });
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
/* 火山 Seedream：真实图全失败才调，返回 OpenAI 兼容结构。失败时返回 {__error} 便于定位 */
async function wSeedream(term, context, env) {
  try {
    const prompt = '为英语表达「' + term + '」生成一张帮助记忆的学习插图。语境：' + (context || '日常真实使用场景') + '。只表现一个自然动作和一个关键物件，画面干净具体，不要出现任何文字、字幕、水印。';
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20000); // 生图比搜图慢，单独放宽到 20 秒
    const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.ARK_API_KEY },
      body: JSON.stringify({
        model: env.SEEDREAM_MODEL || 'doubao-seedream-5-0-flash-260915',
        prompt,
        size: '1024x1024',
        watermark: false,
        response_format: 'url'
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
  let input;
  try { input = await request.json(); } catch (_) { return jerr(400, '请求 JSON 无效', headers); }
  const term = String(input && input.term || '').trim();
  if (!term) return jerr(400, '缺少 term', headers);

  const device = deviceIdOf(request);
  const m = await meter(env, ctx, device, 'image');
  if (m.blocked) return jerr(429, '请求太频繁，稍后再试', { ...headers, 'Retry-After': String(m.retryAfter || 20) });

  let candidates = await wOpenverse(term);
  let source = candidates.length ? 'openverse' : '';
  if (!candidates.length && env.PIXABAY_KEY) {
    candidates = await wPixabay(term, env.PIXABAY_KEY);
    if (candidates.length) source = 'pixabay';
  }
  let seedreamError = '';
  if (!candidates.length && env.ARK_API_KEY) {
    const sr = await wSeedream(term, String(input.context || ''), env);
    if (sr && sr.__error) {
      seedreamError = sr.__error;
    } else if (sr && Array.isArray(sr.items) && sr.items.length) {
      candidates = sr.items;
      source = 'seedream';
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
