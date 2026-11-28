/* ============ 账号 / 登录 / 权益状态（独立 key，不碰任何旧数据） ============
 * 权益跟邮箱走，登录后所有付费请求带 Authorization。
 * 登录弹窗与设置页账号分组均由本模块动态创建，不改动 index.html。
 * ===================================================================== */

const ACCOUNT_KEY = 'english-notes-account-v1';
const ACCOUNT_REQUEST_TIMEOUT_MS = 12000;

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ACCOUNT_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(accountBase() + p, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = {}; }
    return { status: res.status, data: data && typeof data === 'object' ? data : {} };
  } catch (_) {
    const message = ctrl.signal.aborted
      ? '连接账号服务超时，请换个网络再试。'
      : '暂时连不上账号服务，请检查网络后重试。';
    return { status: 0, data: { message } };
  } finally {
    clearTimeout(timer);
  }
}

let pendingEmail = '';
let accountStatusCache = null;
let accountStatusError = '';
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
        '<button class="btn" id="almUseCode" type="button">输入已有验证码</button>' +
      '</div>' +
      '<div id="almCodeStep" hidden>' +
        '<p class="a-note">输入 <b id="almEmailShow"></b> 收到的 6 位验证码，验证码 10 分钟内有效。</p>' +
        '<input id="almCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码" autocomplete="one-time-code">' +
        '<button class="btn primary" id="almDoVerify" type="button">验证并登录</button>' +
        '<button class="btn" id="almBack" type="button">返回换邮箱</button>' +
      '</div>' +
      '<div id="almMsg" class="a-note" role="status" aria-live="polite" style="color:#d83939"></div>' +
    '</div>';
  document.body.appendChild(m);

  const msg = t => {
    $('#almMsg').textContent = t;
  };
  const send = $('#almSendCode'), useCode = $('#almUseCode'), verify = $('#almDoVerify'), back = $('#almBack');
  function emailFromInput() {
    const email = $('#almEmail').value.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
    msg('邮箱格式不正确');
    return '';
  }
  function showCodeStep(email, hint = '') {
    pendingEmail = email;
    $('#almEmailShow').textContent = email;
    $('#almCode').value = '';
    $('#almEmailStep').hidden = true;
    $('#almCodeStep').hidden = false;
    msg(hint);
  }
  $('#almClose').onclick = closeLogin;
  m.addEventListener('click', e => { if (e.target === m) closeLogin(); });

  send.onclick = async () => {
    if (send.disabled) return;
    const email = emailFromInput();
    if (!email) return;
    send.disabled = useCode.disabled = true;
    msg('发送中…');
    try {
      const r = await accountApi('/v1/auth/request-code', { email }, false);
      if (r.status === 200 && r.data.ok === true) {
        showCodeStep(email, r.data.devCode ? '测试验证码：' + r.data.devCode : '');
      } else {
        msg((r.data.message || '发送失败，请稍后再试。') +
          (r.status === 0 || r.status === 429 ? '邮件已收到的话，可以直接输入已有验证码。' : ''));
      }
    } finally {
      send.disabled = useCode.disabled = false;
    }
  };
  useCode.onclick = () => {
    const email = emailFromInput();
    if (email) showCodeStep(email);
  };
  verify.onclick = async () => {
    if (verify.disabled) return;
    const code = $('#almCode').value.trim();
    if (!/^\d{6}$/.test(code)) { msg('请输入 6 位验证码'); return; }
    verify.disabled = back.disabled = true;
    msg('验证中…');
    try {
      const r = await accountApi('/v1/auth/verify', { email: pendingEmail, code }, false);
      if (r.status !== 200 || typeof r.data.token !== 'string' || !r.data.token) {
        msg(r.data.message || '验证失败，请稍后再试');
        return;
      }
      accountStatusCache = null;
      accountStatusError = '';
      accountWrite({ token: r.data.token, email: pendingEmail });
      if(!accountLoggedIn()){
        msg('没有保存登录状态。请检查浏览器是否允许本站存储数据，再获取新验证码。');
        return;
      }
      firstShotAccountOffer = false;
      accountRenderGroup();
      closeLogin(true);
      accountRefresh();
      toast('登录成功');
    } finally {
      verify.disabled = back.disabled = false;
    }
  };
  back.onclick = () => {
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
function closeLogin(verified=false) {
  const m = $('#accountLoginModal');
  if (!m?.classList.contains('show')) return;
  m.classList.remove('show');
  firstOwnLoginClosed(verified===true);
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
  if(firstShotCommercial()){
    const entry=document.createElement('button');
    entry.type='button';
    entry.id='moreAccount';
    entry.className='nav-item';
    entry.innerHTML='<span class="nav-copy"><b class="nav-name">账号</b><small class="nav-desc">登录与每日免费额度</small></span>';
    entry.onclick=()=>{
      ui.sideOpen=false;
      render();
      openSettings();
      sec.classList.add('open');
      sec.scrollIntoView({block:'start'});
      firstShotAccountOpened();
    };
    $('#sideNav').prepend(entry);
  }
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
    const commercial=firstShotCommercial();
    body.innerHTML = '<p class="a-note">' + (commercial?'验证邮箱，每天可免费批改 10 句，生成 20 句语音。':'登录后可以开通站方 AI 额度或领取语音包。') + '</p>' +
      '<button class="btn primary" id="stAccountLogin" type="button">'+(commercial?'验证邮箱':'登录 / 注册')+'</button>' +
      (firstShotAccountOffer?'<button class="btn" id="stAccountLater" type="button">稍后</button>':'');
    $('#stAccountLogin').onclick = openLogin;
    const later=$('#stAccountLater');
    if(later)later.onclick=()=>{firstShotAccountOffer=false;$('#settingsModal').classList.remove('show');accountRenderGroup();};
    return;
  }

  const s = accountStatusCache;
  if (!s) {
    body.innerHTML = '<p class="a-note" id="stAccountState">正在读取账号状态…</p>';
    if (accountStatusError) {
      $('#stAccountState').textContent = accountStatusError;
      const retry = document.createElement('button');
      retry.className = 'btn';
      retry.type = 'button';
      retry.textContent = '重新读取账号';
      retry.onclick = accountRefresh;
      body.appendChild(retry);
    }
    return;
  }
  const L = s.entitlements.limits;
  const M = s.entitlements.monthly;
  const yuan = micro => (micro / 1_000_000).toFixed(2);
  const status = ['active','pending','disabled'].includes(s.account.status) ? s.account.status : 'disabled';
  const tts = L.tts || {};
  let voiceBalance;
  if (s.account.unlimited === true) {
    voiceBalance = '永久免费账号：站方语音不限量，不扣句数';
  } else if (status === 'disabled' || (!tts.hasPackage&&!tts.freeDaily)) {
    voiceBalance = '暂无可用的站方语音包';
  } else {
    voiceBalance = '站方语音：今日免费剩余 ' + (Number(tts.freeLeft)||0) + ' / ' + (Number(tts.freeDaily)||0) + ' 句' +
      (tts.grantRemaining>0 ? '，原语音包剩 ' + Number(tts.grantRemaining) + ' 句' : '');
  }

  const textBalance = s.account.unlimited === true
    ? 'AI 对话与场景生成：永久免费，不限量'
    : 'AI 对话免费批改剩余 ' + L.text.freeLeft + ' 句（今日已用 ' + L.text.used + ' / ' + L.text.freeDaily + '）' +
      (L.text.grantRemaining ? '，加练包剩 ' + L.text.grantRemaining + ' 句' : '');

  body.innerHTML =
    '<div class="st-field"><div class="meta"><b id="stAccountEmail"></b> ' +
      '<span class="badge ' + status + '">' + statusLabel(status) + '</span>' +
      (s.account.unlimited === true ? '<span class="badge active">永久免费</span>' : '') +
      '</div></div>' +
    '<div class="st-field"><label>今日剩余（已用 / 每日免费）</label>' +
      '<p class="a-note">' + textBalance + '</p>' +
      '<p class="a-note">' + voiceBalance + '</p>' +
      '<p class="a-note">当前朗读方式：' + (typeof currentReadingMethodLabel === 'function' ? currentReadingMethodLabel() : '系统朗读') + '</p></div>' +
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
  return status === 'active' ? '已开通' : status === 'pending' ? '已验证邮箱' : '已停用';
}

async function accountRefresh() {
  const token = accountToken();
  if (!token) return;
  const seq = ++accountRefreshRequest;
  try {
    const r = await accountApi('/v1/me/status', {}, true);
    if (seq !== accountRefreshRequest || token !== accountToken()) return;
    if (r.status === 200 && r.data.account && r.data.entitlements) {
      accountStatusCache = r.data;
      accountStatusError = '';
    } else if (r.status === 401) {
      try { localStorage.removeItem(ACCOUNT_KEY); } catch (_) {}
      accountStatusCache = null;
      accountStatusError = '';
      stopSpeech();
    } else {
      accountStatusError = r.data.message || '暂时读不到账号状态，请重试。';
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
