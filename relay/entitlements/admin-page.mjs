/* ============ 极简管理员页面（GET /admin 返回） ============
 * 自包含、无外部依赖、手机优先。凭 ADMIN_TOKEN 调用 /v1/admin/*。
 * 安全：邮箱一律用 textContent 当纯文本渲染（不拼 HTML）；所有按钮用 addEventListener
 * 事件绑定（不用内联 onclick），避免邮箱内容打断脚本或注入标记。
 * ===================================================== */

export function renderAdminPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>权益管理</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         background:#f5f6f8; color:#1f2329; padding:16px; max-width:560px; margin:0 auto; }
  h1 { font-size:18px; margin:4px 0 16px; }
  h2 { font-size:15px; margin:20px 0 8px; }
  .card { background:#fff; border-radius:12px; padding:14px; margin-bottom:12px;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
  label { display:block; font-size:13px; color:#646a73; margin:8px 0 4px; }
  input, select { width:100%; padding:10px 12px; border:1px solid #d8dce3; border-radius:8px;
                  font-size:15px; background:#fff; }
  button { border:0; border-radius:8px; padding:10px 16px; font-size:15px; font-weight:600;
           background:#3370ff; color:#fff; width:100%; margin-top:12px; }
  button.ghost { background:#eef1f6; color:#1f2329; width:auto; padding:7px 12px; margin:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:8px;
         padding:10px 0; border-bottom:1px solid #f0f1f3; }
  .row:last-child { border-bottom:0; }
  .meta { font-size:13px; color:#646a73; word-break:break-all; }
  .badge { font-size:12px; padding:2px 8px; border-radius:999px; }
  .pending { background:#fff3e0; color:#d48806; }
  .active { background:#e8f7ee; color:#2ba471; }
  .disabled { background:#f0f1f3; color:#8a9099; }
  #msg { font-size:13px; min-height:18px; margin-top:8px; }
  .ok { color:#2ba471; } .err { color:#d83939; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
</style>
</head>
<body>
<h1>权益管理</h1>

<div class="card">
  <label>管理员密钥</label>
  <input id="token" type="password" autocomplete="off" placeholder="输入 ADMIN_TOKEN">
  <button id="btnEnter" type="button">进入并刷新列表</button>
</div>

<div class="card">
  <h2 style="margin-top:0">账号列表</h2>
  <div id="accounts"><div class="meta">先输入密钥并进入。</div></div>
</div>

<div class="card">
  <h2 style="margin-top:0">发加练包</h2>
  <label>邮箱</label><input id="gEmail" type="email" autocomplete="off" placeholder="user@example.com">
  <div class="grid2">
    <div><label>类型</label>
      <select id="gKind"><option value="text">DeepSeek 句数</option><option value="tts">CosyVoice 句数</option></select>
    </div>
    <div><label>数量</label><input id="gAmount" type="number" min="1" value="20"></div>
  </div>
  <label>备注（可选）</label><input id="gNote" type="text" placeholder="如：首批加练">
  <button id="btnGrant" type="button">发放</button>
</div>

<div id="msg"></div>

<div class="card">
  <h2 style="margin-top:0">站方费用</h2>
  <button id="btnBudgetList" type="button">刷新待核对记录</button>
  <button id="btnRetryAlert" type="button">重试本月费用提醒</button>
  <div id="budgetHolds" class="meta" aria-live="polite"></div>
  <label for="holdId">待核对记录编号</label>
  <input id="holdId" type="text" autocomplete="off">
  <label for="holdDecision">核对结果</label>
  <select id="holdDecision"><option value="settled">已扣费，按实际金额结算</option><option value="released">确认未扣费，释放预留</option></select>
  <label for="holdActual">实际扣费（元，已扣费时填写）</label>
  <input id="holdActual" type="number" min="0.000001" step="0.000001" inputmode="decimal">
  <button id="btnResolveBudget" type="button">保存核对结果</button>
  <div id="budgetMessage" class="meta" aria-live="polite"></div>
</div>

<script>
function setMsg(t, ok){ var el=document.getElementById('msg'); el.textContent=t;
  el.className = ok ? 'ok' : 'err'; }
function tok(){ return document.getElementById('token').value.trim(); }

async function api(path, body){
  var res = await fetch(path, { method:'POST',
    headers:{'Content-Type':'application/json','X-Admin-Token':tok()},
    body: JSON.stringify(body || {}) });
  var data = await res.json().catch(function(){ return {message:'返回无法解析'}; });
  if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
  return data;
}

async function loadAccounts(){
  try {
    var data = await api('/v1/admin/accounts', {});
    var box = document.getElementById('accounts');
    box.textContent = '';
    if (!data.accounts.length) {
      var empty = document.createElement('div');
      empty.className = 'meta';
      empty.textContent = '暂无账号。';
      box.appendChild(empty);
      return;
    }
    data.accounts.forEach(function(a){
      var row = document.createElement('div');
      row.className = 'row';

      var left = document.createElement('div');
      left.className = 'meta';
      var emailDiv = document.createElement('div');
      emailDiv.textContent = a.email;                 /* 邮箱：纯文本，不拼 HTML */
      var badge = document.createElement('span');
      badge.className = 'badge ' + a.status;
      badge.textContent = a.status;
      left.appendChild(emailDiv);
      left.appendChild(badge);
      row.appendChild(left);

      if (a.status !== 'active') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ghost';
        btn.textContent = '开通';
        btn.addEventListener('click', function(){ doActivate(a.email); }); /* 事件绑定 */
        row.appendChild(btn);
      }
      box.appendChild(row);
    });
    setMsg('共 ' + data.accounts.length + ' 个账号', true);
  } catch (e) { setMsg(e.message, false); }
}

async function doActivate(email){
  try { await api('/v1/admin/activate', { email: email }); setMsg('已开通 ' + email, true); loadAccounts(); }
  catch (e) { setMsg(e.message, false); }
}

async function doGrant(){
  try {
    var body = { email: document.getElementById('gEmail').value.trim(),
      kind: document.getElementById('gKind').value,
      amount: parseInt(document.getElementById('gAmount').value, 10),
      note: document.getElementById('gNote').value.trim() };
    if (!body.email || !body.amount) { setMsg('请填邮箱和数量', false); return; }
    await api('/v1/admin/grant', body);
    setMsg('加练包已发放', true); loadAccounts();
  } catch (e) { setMsg(e.message, false); }
}

function budgetMsg(text){ document.getElementById('budgetMessage').textContent = text; }

async function loadBudgetHolds(){
  try {
    var data = await api('/v1/admin/budget-holds');
    var list = document.getElementById('budgetHolds');
    list.textContent = data.holds.length ? '' : '没有待核对记录。';
    data.holds.forEach(function(hold){
      var row = document.createElement('div');
      row.className = 'row';
      var info = document.createElement('span');
      info.textContent = hold.month + ' · ' + (hold.service === 'text' ? 'DeepSeek' : 'CosyVoice') +
        ' · 预留 ¥' + (hold.max_micro / 1000000).toFixed(6) + ' · ' + hold.id;
      var select = document.createElement('button');
      select.type = 'button';
      select.className = 'ghost';
      select.textContent = '选中';
      select.addEventListener('click', function(){ document.getElementById('holdId').value = hold.id; });
      row.append(info, select);
      list.appendChild(row);
    });
  } catch (e) { budgetMsg(e.message); }
}

async function resolveBudgetHold(){
  try {
    var decision = document.getElementById('holdDecision').value;
    var holdId = document.getElementById('holdId').value.trim();
    var actual = Number(document.getElementById('holdActual').value);
    if (!holdId || (decision === 'settled' && (!Number.isFinite(actual) || actual <= 0))) {
      return budgetMsg('请选择记录，已扣费时填入实际金额。');
    }
    await api('/v1/admin/budget-holds/resolve', { holdId: holdId, decision: decision,
      actualMicro: decision === 'settled' ? Math.round(actual * 1000000) : 0 });
    budgetMsg('已保存核对结果。');
    document.getElementById('holdId').value = '';
    document.getElementById('holdActual').value = '';
    await loadBudgetHolds();
  } catch (e) { budgetMsg(e.message); }
}

async function retryBudgetAlert(){
  try {
    var result = await api('/v1/admin/budget-alert/retry');
    budgetMsg(!result.pending ? '本月没有待发提醒。' : result.simulated ? '已记录模拟提醒。' : '提醒已提交发送。');
  } catch (e) { budgetMsg(e.message); }
}

document.getElementById('btnEnter').addEventListener('click', loadAccounts);
document.getElementById('btnGrant').addEventListener('click', doGrant);
document.getElementById('btnBudgetList').addEventListener('click', loadBudgetHolds);
document.getElementById('btnResolveBudget').addEventListener('click', resolveBudgetHold);
document.getElementById('btnRetryAlert').addEventListener('click', retryBudgetAlert);
</script>
</body>
</html>`;
}
