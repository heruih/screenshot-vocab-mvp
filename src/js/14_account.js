/* ============ 账号 / 登录 / 权益状态（独立 key，不碰任何旧数据） ============
 * 权益跟邮箱走，登录后所有付费请求带 Authorization。
 * 登录弹窗与设置页账号分组均由本模块动态创建，不改动 index.html。
 * ===================================================================== */

const ACCOUNT_KEY = 'english-notes-account-v1';

function accountRead() { try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)) || {}; } catch (_) { return {}; } }
function accountWrite(v) { try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(v)); } catch (_) {} }
function accountToken() { return accountRead().token || ''; }
function accountEmail() { return accountRead().email || ''; }
function accountLoggedIn() { return !!accountToken(); }
function accountAuthHeader() {
  const t = accountToken();
  return t ? { Authorization: 'Bearer ' + t } : {};
}
function accountBase() { return textRelayConfig().relayUrl.replace(/\/+$/, ''); }

async function accountApi(p, body, withAuth) {
  const headers = { 'Content-Type': 'application/json' };
  if (withAuth) Object.assign(headers, accountAuthHeader());
  const res = await fetch(accountBase() + p, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  return { status: res.status, data };
}

let pendingEmail = '';
let accountStatusCache = null;
let accountRefreshRequest = 0;

/* ---------------- 登录弹窗 ---------------- */

function ensureLoginModal() {
  if ($('#accountLoginModal')) return;
  const m = document.createElement('div');
  m.className = 'modal';
  m.id = 'accountLoginModal';
  m.innerHTML =
    '<div class="modal-card" style="padding:18px">' +
      '<div class="wm-head"><b>登录账号</b><button class="modal-close" id="almClose" type="button" aria-label="关闭">×</button></div>' +
      '<div id="almEmailStep">' +
        '<p class="a-note">输入邮箱获取 6 位验证码。登录后权益跟邮箱走，换手机或多设备都能用。</p>' +
        '<input id="almEmail" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email">' +
        '<button class="btn primary" id="almSendCode" type="button">获取验证码</button>' +
      '</div>' +
      '<div id="almCodeStep" hidden>' +
        '<p class="a-note">验证码已发送到 <b id="almEmailShow"></b>，10 分钟内有效。</p>' +
        '<input id="almCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码" autocomplete="one-time-code">' +
        '<button class="btn primary" id="almDoVerify" type="button">验证并登录</button>' +
        '<button class="btn" id="almBack" type="button">返回换邮箱</button>' +
      '</div>' +
      '<div id="almMsg" class="a-note" style="color:#d83939"></div>' +
    '</div>';
  document.body.appendChild(m);

  const msg = t => { $('#almMsg').textContent = t; };
  $('#almClose').onclick = closeLogin;
  m.addEventListener('click', e => { if (e.target === m) closeLogin(); });

  $('#almSendCode').onclick = async () => {
    const email = $('#almEmail').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg('邮箱格式不正确'); return; }
    msg('发送中…');
    const r = await accountApi('/v1/auth/request-code', { email }, false);
    if (r.status !== 200) { msg(r.data.message || '发送失败，请稍后再试'); return; }
    pendingEmail = email;
    $('#almEmailShow').textContent = email;
    $('#almEmailStep').hidden = true;
    $('#almCodeStep').hidden = false;
    msg(r.data.devCode ? '测试模式未配发信，验证码：' + r.data.devCode : '');
  };

  $('#almDoVerify').onclick = async () => {
    const code = $('#almCode').value.trim();
    msg('验证中…');
    const r = await accountApi('/v1/auth/verify', { email: pendingEmail, code }, false);
    if (r.status !== 200) { msg(r.data.message || '验证失败'); return; }
    accountStatusCache = null;
    accountWrite({ token: r.data.token, email: pendingEmail });
    accountRenderGroup();
    closeLogin();
    accountRefresh();
    toast('登录成功');
  };
  $('#almBack').onclick = () => {
    $('#almCodeStep').hidden = true;
    $('#almEmailStep').hidden = false;
    msg('');
  };
}

function openLogin() {
  ensureLoginModal();
  $('#almMsg').textContent = '';
  $('#accountLoginModal').classList.add('show');
}
function closeLogin() {
  const m = $('#accountLoginModal');
  if (m) m.classList.remove('show');
}

/* ---------------- 设置页账号分组 ---------------- */

function ensureAccountGroup() {
  if ($('#stgAccount')) return;
  const sec = document.createElement('section');
  sec.className = 'st-group open';
  sec.id = 'stgAccount';
  sec.innerHTML =
    '<button class="st-g-head" type="button"><span class="st-g-t">账号</span>' +
    '<span class="st-g-s" id="stgSumAccount">未登录</span><b class="st-chev">›</b></button>' +
    '<div class="st-g-body" id="stgAccountBody"></div>';
  const first = $('#settingsModal .st-group');
  first.parentNode.insertBefore(sec, first);
  accountRenderGroup();
}

function accountRenderGroup() {
  refreshCommercialSpeechSettings();
  const body = $('#stgAccountBody');
  if (!body) return;
  $('#stgSumAccount').textContent = accountLoggedIn()
    ? (accountStatusCache ? statusLabel(accountStatusCache.account.status) : '已登录')
    : '未登录';

  if (!accountLoggedIn()) {
    body.innerHTML = '<p class="a-note">登录后可以开通站方 AI 额度或领取单独发放的语音包。</p>' +
      '<button class="btn primary" id="stAccountLogin" type="button">登录 / 注册</button>';
    $('#stAccountLogin').onclick = openLogin;
    return;
  }

  const s = accountStatusCache;
  if (!s) { body.innerHTML = '<p class="a-note">正在读取账号状态…</p>'; return; }
  const L = s.entitlements.limits;
  const M = s.entitlements.monthly;
  const yuan = micro => (micro / 1_000_000).toFixed(2);
  const status = ['active','pending','disabled'].includes(s.account.status) ? s.account.status : 'disabled';
  const voiceBalance = status !== 'disabled' && L.tts.hasPackage
    ? '站方语音包剩余 ' + Number(L.tts.grantRemaining) + ' 句'
    : '暂无可用的站方语音包';

  body.innerHTML =
    '<div class="st-field"><div class="meta"><b id="stAccountEmail"></b> ' +
      '<span class="badge ' + status + '">' + statusLabel(status) + '</span></div></div>' +
    '<div class="st-field"><label>今日剩余（已用 / 每日免费）</label>' +
      '<p class="a-note">AI 句子：' + L.text.freeLeft + ' 句（今日已用 ' + L.text.used + ' / ' + L.text.freeDaily + '）' +
      (L.text.grantRemaining ? '，加练包剩 ' + L.text.grantRemaining : '') + '</p>' +
      '<p class="a-note">' + voiceBalance + '</p></div>' +
    '<div class="st-field"><label>本月站方成本（100 元提醒 / 150 元封顶）</label>' +
      '<p class="a-note">已累计 ¥' + yuan(M.totalMicro) + '，跨月自动重置。</p></div>' +
    '<button class="btn" id="stAccountRefresh" type="button">刷新状态</button>' +
    '<button class="btn" id="stAccountLogout" type="button">退出登录</button>';

  $('#stAccountEmail').textContent = s.account.email;
  $('#stAccountRefresh').onclick = accountRefresh;
  $('#stAccountLogout').onclick = () => {
    try { localStorage.removeItem(ACCOUNT_KEY); } catch (_) {}
    accountStatusCache = null;
    stopSpeech();
    accountRenderGroup();
    toast('已退出登录');
  };
}

function statusLabel(status) {
  return status === 'active' ? '已开通' : status === 'pending' ? '待开通' : '已停用';
}

async function accountRefresh() {
  const token = accountToken();
  if (!token) return;
  const seq = ++accountRefreshRequest;
  try {
    const r = await accountApi('/v1/me/status', {}, true);
    if (seq !== accountRefreshRequest || token !== accountToken()) return;
    if (r.status === 200) {
      accountStatusCache = r.data;
    } else if (r.status === 401) {
      try { localStorage.removeItem(ACCOUNT_KEY); } catch (_) {}
      accountStatusCache = null;
      stopSpeech();
    }
  } catch (_) {}
  if (seq === accountRefreshRequest) accountRenderGroup();
}

/* 需要登录的操作：未登录则弹窗并返回 false */
function accountEnsureLogin() {
  if (accountLoggedIn()) return true;
  openLogin();
  return false;
}

function accountInit() {
  ensureLoginModal();
  ensureAccountGroup();
  if (accountLoggedIn()) accountRefresh();
}
