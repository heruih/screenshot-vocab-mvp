/* ============ 极简管理员页面（GET /admin 返回） ============
 * 自包含、无外部依赖、手机优先。凭 ADMIN_TOKEN 调用 /v1/admin/*。
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
  <button onclick="loadAccounts()">进入并刷新列表</button>
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
  <button onclick="doGrant()">发放</button>
</div>

<div id="msg"></div>

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
    if (!data.accounts.length) { box.innerHTML = '<div class="meta">暂无账号。</div>'; return; }
    box.innerHTML = '';
    data.accounts.forEach(function(a){
      var row = document.createElement('div');
      row.className = 'row';
      var left = '<div class="meta"><div>' + a.email + '</div>' +
        '<span class="badge ' + a.status + '">' + a.status + '</span></div>';
      var btn = a.status === 'active' ? '' :
        '<button class="ghost" onclick="doActivate(\\'' + a.email + '\\')">开通</button>';
      row.innerHTML = left + btn;
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
</script>
</body>
</html>`;
}
