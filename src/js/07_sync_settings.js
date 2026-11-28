/* ============ 云同步（GitHub Gist / WebDAV / 自建地址） ============
   不依赖本机 localStorage：整份数据存到你自己的一个私密位置，
   换设备 / 换网址填同一份凭据就能接上；合并按 id + 更新时间，删除用墓碑记录。 */
const SYNC_FILE='english-notes-sync.json';
const SYNC_KEEP_DAYS=120;
let syncBusy=false,syncTimer=0,syncTypingTimer=0,syncStartAt=0;
/* 请求超时：手机网络到 api.github.com 经常直接卡住（不给响应也不报错） */
let SYNC_TIMEOUT=15000;
/* 记住上一次同步的结果文案，别被后续渲染覆盖掉 */
let syncStatusMsg='',syncStatusErr=false;
function syncCfg(){
  state.meta=state.meta||{};
  /* 必须原地补齐、返回同一个对象：否则异步同步过程中写回的 Gist ID 会落到旧对象上丢掉 */
  if(!state.meta.sync||typeof state.meta.sync!=='object') state.meta.sync={};
  const c=state.meta.sync;
  ['ghToken','ghGistId','url','user','pass'].forEach(k=>{ if(typeof c[k]!=='string') c[k]=c[k]?String(c[k]):''; });
  if(!c.provider) c.provider='gist';
  if(typeof c.auto!=='boolean') c.auto=true;
  if(typeof c.lastAt!=='number') c.lastAt=0;
  if(typeof c.lastBy!=='string') c.lastBy='';
  if(!state.meta.device) state.meta.device=uid();
  return c;
}
/* 没填过通道时按 GitHub Gist 算（和界面上默认高亮的那一项一致） */
function syncProv(cfg){ return (cfg&&cfg.provider==='dav')?'dav':'gist'; }
function syncReady(cfg){
  if(!cfg) return false;
  return syncProv(cfg)==='gist'?!!String(cfg.ghToken||'').trim():!!String(cfg.url||'').trim();
}
function syncNeedMsg(cfg){
  return syncProv(cfg)==='gist'?'先填 GitHub Token（要勾 gist 权限）':'先填云端地址';
}
function addGrave(type,id){
  if(!id) return;
  state.grave=Array.isArray(state.grave)?state.grave:[];
  state.grave.push({t:type,id:id,at:Date.now()});
  if(state.grave.length>800) state.grave=state.grave.slice(-800);
}
function demoOnly(){
  const words=(state.words||[]).filter(w=>w.source!=='demo');
  const notes=(state.notes||[]).filter(n=>n.id!=='n_welcome');
  return !words.length&&!notes.length;
}
function localDoc(){
  return {v:1,at:Date.now(),device:state.meta&&state.meta.device||'',
    folders:state.folders||[],notes:state.notes||[],words:state.words||[],
    aiLog:state.aiLog||[],grave:state.grave||[],tagList:state.tagList||[]};
}
/* 两份数据合并：同 id 取更新时间较新的；墓碑时间晚于条目更新时间的视为已删除 */
function mergeDocs(a,b){
  a=a||{}; b=b||{};
  const gmap={};
  (a.grave||[]).concat(b.grave||[]).forEach(g=>{
    if(!g||!g.id) return;
    const k=g.t+':'+g.id;
    if(gmap[k]===undefined||gmap[k]<(g.at||0)) gmap[k]=g.at||0;
  });
  const cut=Date.now()-SYNC_KEEP_DAYS*DAY;
  const graveList=Object.keys(gmap).filter(k=>gmap[k]>cut).map(k=>{
    const p=k.split(':');
    return {t:p[0],id:p.slice(1).join(':'),at:gmap[k]};
  });
  const alive={};
  graveList.forEach(g=>{ alive[g.t+':'+g.id]=g.at; });
  const pick=(x,y,type)=>{
    const map=new Map();
    (x||[]).forEach(it=>{ if(it&&it.id) map.set(it.id,it); });
    (y||[]).forEach(it=>{
      if(!it||!it.id) return;
      const old=map.get(it.id);
      if(!old){ map.set(it.id,it); return; }
      const ta=old.updatedAt||old.createdAt||0,tb=it.updatedAt||it.createdAt||0;
      map.set(it.id,tb>=ta?it:old);
    });
    return [...map.values()].filter(it=>{
      const g=alive[type+':'+it.id];
      return !(g&&g>=(it.updatedAt||it.createdAt||0));
    });
  };
  const logs=new Map();
  (a.aiLog||[]).concat(b.aiLog||[]).forEach(l=>{ if(l&&l.id) logs.set(l.id,l); });
  /* 只要任意一台设备有真实内容，示例数据就不再参与同步（新设备不会被示例词污染） */
  const hasReal=d=>((d.words||[]).some(w=>w&&w.source!=='demo'))||((d.notes||[]).some(n=>n&&n.id!=='n_welcome'));
  const keepDemo=!hasReal(a)&&!hasReal(b);
  const notesOut=pick(a.notes,b.notes,'note');
  const wordsOut=pick(a.words,b.words,'word');
  /* 标签类别：两边取并集；被删除过的标签（墓碑）剔掉，别被另一台设备复活 */
  const tset=new Set();
  (a.tagList||[]).concat(b.tagList||[]).forEach(t=>{ if(t) tset.add(t); });
  wordsOut.forEach(w=>(w.tags||[]).forEach(t=>{ if(t) tset.add(t); }));
  const tagsOut=[...tset].filter(t=>{ const g=alive['tag:'+t]; return !g; });
  return {
    folders:pick(a.folders,b.folders,'folder').sort((x,y)=>(x.createdAt||0)-(y.createdAt||0)),
    notes:keepDemo?notesOut:notesOut.filter(n=>n.id!=='n_welcome'),
    words:keepDemo?wordsOut:wordsOut.filter(w=>w.source!=='demo'),
    aiLog:[...logs.values()].sort((x,y)=>(y.createdAt||0)-(x.createdAt||0)).slice(0,300),
    grave:graveList,
    tagList:tagsOut
  };
}
function applyDoc(doc){
  const snap=()=>JSON.stringify([state.folders,state.notes,state.words,state.aiLog]);
  const before=snap();
  state.folders=doc.folders||[]; state.notes=doc.notes||[];
  state.words=doc.words||[]; state.aiLog=doc.aiLog||[]; state.grave=doc.grave||[];
  state.tagList=Array.isArray(doc.tagList)?doc.tagList:[];
  (state.words||[]).forEach(ensureSrs);
  return snap()!==before;
}
/* ---------- 随身同步码：没有 GitHub 也能把数据搬到另一台设备 ---------- */
const CODE_PREFIX='ENSYNC1:';
function b64enc(s){ try{ return btoa(unescape(encodeURIComponent(String(s||'')))); }catch(_){ return ''; } }
function b64dec(s){ try{ return decodeURIComponent(escape(atob(String(s||'')))); }catch(_){ return ''; } }
function syncCodeMake(){
  const d=localDoc();
  const json=JSON.stringify({v:1,at:Date.now(),folders:d.folders||[],notes:d.notes||[],words:d.words||[],
    aiLog:(d.aiLog||[]).slice(0,100),tagList:d.tagList||[]});
  const code=CODE_PREFIX+b64enc(json);
  const box=$('#stCodeBox'); if(box) box.value=code;
  const note=$('#stCodeNote');
  if(note) note.textContent='已生成约 '+Math.max(1,Math.round(code.length/1024))+' KB · 点「复制」或「分享到…」发到另一台设备，在那边粘贴后点「导入粘贴的码」';
  return code;
}
function syncCodeApply(){
  const box=$('#stCodeBox');
  const raw=String(box?box.value:'').trim();
  const i=raw.indexOf(CODE_PREFIX);
  if(i<0){ toast('先把另一台设备的同步码粘到框里','warn'); return false; }
  let obj=null;
  try{ obj=JSON.parse(b64dec(raw.slice(i+CODE_PREFIX.length).replace(/\s+/g,''))); }catch(_){ }
  if(!obj||!Array.isArray(obj.words)||!Array.isArray(obj.notes)){ toast('同步码不完整，请重新复制一次','warn'); return false; }
  const merged=mergeDocs(localDoc(),obj);
  applyDoc(merged); save(); render();
  try{ syncSettingsUI(); }catch(_){ }
  const note=$('#stCodeNote');
  if(note) note.textContent='已导入并合并：现在共 '+state.words.length+' 个单词 · '+state.notes.length+' 篇笔记（本机内容都在）';
  toast('已导入，两边的都留下了');
  return true;
}
function syncCodeCopy(){
  const box=$('#stCodeBox');
  let v=box?String(box.value||'').trim():'';
  if(!v||v.indexOf(CODE_PREFIX)<0) v=syncCodeMake();
  const done=()=>toast('已复制，去另一台设备粘贴导入');
  const manual=()=>{
    try{ box.focus(); box.select(); document.execCommand('copy'); done(); }
    catch(_){ toast('复制失败：长按框里的码手动复制','warn'); }
  };
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done).catch(manual);
    else manual();
  }catch(_){ manual(); }
}
async function syncCodeShare(){
  const box=$('#stCodeBox');
  let v=box?String(box.value||'').trim():'';
  if(!v||v.indexOf(CODE_PREFIX)<0) v=syncCodeMake();
  try{
    if(navigator.share){ await navigator.share({title:'英语学习笔记 · 同步码',text:v}); return; }
  }catch(_){ }
  syncCodeCopy();
}
function syncB64(s){ try{ return btoa(unescape(encodeURIComponent(String(s||'')))); }catch(e){ return ''; } }
function syncAuth(cfg){ return cfg.user?{Authorization:'Basic '+syncB64(cfg.user+':'+(cfg.pass||''))}:{}; }
function syncFetch(url,opt,ms){
  const limit=ms||SYNC_TIMEOUT;
  const o=Object.assign({},opt||{});
  let ctrl=null;
  try{ if(typeof AbortController!=='undefined'){ ctrl=new AbortController(); o.signal=ctrl.signal; } }catch(_){}
  let timer=0;
  const timeout=new Promise((_,rej)=>{
    timer=setTimeout(()=>{
      try{ if(ctrl) ctrl.abort(); }catch(_){}
      const e=new Error('timeout'); e.name='AbortError'; rej(e);
    },limit);
  });
  return Promise.race([fetch(url,o),timeout]).finally(()=>clearTimeout(timer));
}
function syncHttpMsg(name,st){
  if(st===401||st===403) return name+' 拒绝访问：令牌或密码不对，或没有相应权限';
  if(st===404) return name+' 返回 404：地址不对，或文件还没建好';
  if(st===413) return name+' 说内容太大';
  if(st===429) return name+' 请求太频繁，等一会儿再试';
  if(st>=500) return name+' 服务端出错';
  return name+' 返回 HTTP '+st;
}
function syncNetMsg(task,err,ms){
  const aborted=!!(err&&(err.name==='AbortError'||/abort|timeout/i.test(String(err.message||err))));
  const sec=Math.round((ms||SYNC_TIMEOUT)/1000);
  if(aborted){
    if(/Gist|GitHub/i.test(task)) return 'GitHub 连接超时（'+sec+' 秒无响应）：当前网络访问不了 api.github.com，换 Wi-Fi/流量再试，或用自建地址（如 Cloudflare Worker）';
    return task+'超时（'+sec+' 秒无响应）：检查网络或地址后重试';
  }
  return task+'失败：可能网络不通，或被浏览器跨域（CORS）拦住了';
}
function syncWhen(t){
  if(!t) return '还没同步过';
  const d=new Date(t),n=new Date();
  const hm=('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
  if(d.toDateString()===n.toDateString()) return '今天 '+hm;
  return (d.getMonth()+1)+'月'+d.getDate()+'日 '+hm;
}
function syncSetStatus(t,err){
  syncStatusMsg=t||''; syncStatusErr=!!err;
  const el=$('#stSyncStatus');
  if(el){ el.textContent=t; el.classList.toggle('warn',!!err); }
}
async function syncPull(cfg){
  if(cfg.provider==='gist'){
    if(!cfg.ghGistId) return null;
    let r;
    try{ r=await syncFetch('https://api.github.com/gists/'+cfg.ghGistId,{headers:{Authorization:'Bearer '+cfg.ghToken,Accept:'application/vnd.github+json'}}); }
    catch(e){ throw new Error(syncNetMsg('读取 Gist',e)); }
    if(r.status===404) return null;
    if(!r.ok) throw new Error(syncHttpMsg('GitHub',r.status));
    const j=await r.json();
    const f=j.files&&j.files[SYNC_FILE];
    if(!f) return null;
    let txt=f.content||'';
    if(f.truncated&&f.raw_url){ try{ txt=await (await syncFetch(f.raw_url)).text(); }catch(e){} }
    try{ return JSON.parse(txt); }catch(e){ return null; }
  }
  let r;
  try{ r=await syncFetch(cfg.url,{method:'GET',headers:Object.assign({Accept:'application/json'},syncAuth(cfg)),cache:'no-store'}); }
  catch(e){ throw new Error(syncNetMsg('下载云端文件',e)); }
  if(r.status===404) return null;
  if(!r.ok) throw new Error(syncHttpMsg('云端地址',r.status));
  try{ return JSON.parse(await r.text()); }catch(e){ return null; }
}
async function syncPush(cfg,doc){
  const text=JSON.stringify(doc);
  if(cfg.provider==='gist'){
    const obj={description:'英语学习笔记 · 云同步（私有）',public:false,files:{}};
    obj.files[SYNC_FILE]={content:text};
    const common={Accept:'application/vnd.github+json',Authorization:'Bearer '+cfg.ghToken,'Content-Type':'application/json'};
    const send=(id)=>syncFetch('https://api.github.com/gists'+(id?'/'+id:''),
      {method:id?'PATCH':'POST',headers:common,body:JSON.stringify(obj)});
    let r;
    try{ r=await send(cfg.ghGistId); }
    catch(e){ throw new Error(syncNetMsg('写入 Gist',e)); }
    /* 原来的 Gist 被删了：丢掉旧 id，重新建一个 */
    if(r.status===404&&cfg.ghGistId){
      cfg.ghGistId='';
      try{ r=await send(''); }catch(e){ throw new Error(syncNetMsg('写入 Gist',e)); }
    }
    if(!r.ok) throw new Error(syncHttpMsg('GitHub',r.status));
    const j=await r.json();
    if(j&&j.id) cfg.ghGistId=j.id;
    return;
  }
  let r;
  try{ r=await syncFetch(cfg.url,{method:'PUT',headers:Object.assign({'Content-Type':'application/json'},syncAuth(cfg)),body:text}); }
  catch(e){ throw new Error(syncNetMsg('上传到云端',e)); }
  if(!r.ok) throw new Error(syncHttpMsg('云端地址',r.status));
}
async function syncNow(manual){
  const cfg=syncCfg();
  if(!syncReady(cfg)){
    if(manual){
      toast(syncNeedMsg(cfg),'warn');
      syncSetStatus(syncProv(cfg)==='gist'?'还没填 GitHub Token':'还没填云端地址',true);
    }
    return;
  }
  if(syncBusy){
    const waited=Date.now()-(syncStartAt||0);
    if(waited<SYNC_TIMEOUT+5000){
      if(manual) toast('上一次同步还没结束（'+Math.max(1,Math.round(waited/1000))+' 秒），再等等…','warn');
      return;
    }
    /* 超过 20 秒还挂着：多半是上一次请求卡死了，强制解锁重来 */
    syncBusy=false;
  }
  syncBusy=true; syncStartAt=Date.now();
  syncSetStatus('正在同步…');
  try{
    const remote=await syncPull(cfg);
    /* 新设备打开就有示例数据：此时别把示例和云端真数据混在一起 */
    const merged=(remote&&demoOnly())?Object.assign({},remote):mergeDocs(localDoc(),remote||{});
    const changed=applyDoc(merged);
    await syncPush(cfg,Object.assign({},merged,{v:1,at:Date.now(),device:state.meta.device}));
    cfg.lastAt=Date.now(); cfg.lastBy=state.meta.device;
    save(true);
    const editing=document.activeElement&&document.activeElement.isContentEditable;
    if(!editing) render();
    const cnt='笔记 '+state.notes.length+' · 单词 '+state.words.length+' · 文件夹 '+state.folders.length;
    syncSetStatus('已同步 '+syncWhen(cfg.lastAt)+' · '+cnt);
    if(!state.meta.sync.ghGistId&&syncProv(cfg)==='gist') syncSetStatus('已同步，但没拿到 Gist 编号，下次会再建一个',true);
    if(manual) toast(changed?'同步完成：已合并云端的新内容':'同步完成：两边已经一致','ok');
  }catch(e){
    const m=(e&&e.message)||String(e);
    syncSetStatus('同步失败：'+m,true);
    if(manual) toast('同步失败：'+m,'warn');
  }finally{ syncBusy=false; syncStartAt=0; }
}
function scheduleSync(){
  const cfg=state&&state.meta&&state.meta.sync;
  if(!cfg||!cfg.auto||!syncReady(cfg)) return;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>{ if(!syncBusy) syncNow(false); },5000);
}
/* 打开时自动拉一次，换设备就能把云端数据接回来 */
function syncOnBoot(){
  const cfg=syncCfg();
  if(cfg.auto&&syncReady(cfg)) setTimeout(()=>{ if(!syncBusy) syncNow(false); },1500);
}

/* ============ 设置 ============ */
function backupAgeDays(){
  const t=state.meta&&state.meta.backupAt;
  if(!t) return null;
  return Math.floor((Date.now()-t)/DAY);
}
function backupNoteText(){
  const cfg=state&&state.meta&&state.meta.sync;
  if(cfg&&syncReady(cfg)&&cfg.lastAt) return '已开启云同步（'+syncWhen(cfg.lastAt)+'）：换设备能接回来；再导出一份备份更保险';
  const d=backupAgeDays();
  if(d===null) return '还没有备份过：清缓存或换设备会丢数据，建议先导出一份';
  if(d<=0) return '上次备份：今天';
  if(d===1) return '上次备份：昨天';
  return '上次备份：'+d+' 天前'+(d>=7?'（有点久了，建议再导出一次）':'');
}
function stGroupSummary(){
  const st=state.settings||{};
  const set=(id,txt)=>{ const el=$('#'+id); if(el) el.textContent=txt; };
  let aiSum=st.apiKey?('已配置 · '+(st.model||'默认模型')):'未配置 Key';
  if(st.pixabayKey) aiSum+=' · 已配图';
  set('stgSumAi',aiSum);
  const themeLabel={study:'暖纸书房',midnight:'午夜编辑',paper:'温暖纸张',lavender:'柔雾薰衣草',dark:'午夜编辑',light:'温暖纸张'};
  set('stgSumLook',(themeLabel[st.theme]||'暖纸书房')+' · 字号'+(st.fs==='l'?'大':(st.fs==='s'?'小':'中')));
  try{
    const cfg0=state.meta&&state.meta.sync;
    if(cfg0&&syncReady(cfg0)&&cfg0.lastAt) set('stgSumData','已开启云同步');
    else{
      const d0=backupAgeDays();
      set('stgSumData',d0===null?'还没有备份':(d0<=0?'今天备份过':(d0===1?'昨天备份过':d0+' 天前备份')));
    }
  }catch(_){ }
  try{
    const cfg=syncLiveCfg();
    set('stgSumSync',syncReady(cfg)?(cfg.lastAt?('已同步 · '+syncWhen(cfg.lastAt)):'已配置 · 还没同步'):'未配置');
  }catch(_){ }
}
function syncSettingsUI(){
  const st=state.settings||{};
  try{ stGroupSummary(); }catch(_){ }
  const activeTheme=st.theme==='dark'?'midnight':(st.theme==='light'?'paper':(st.theme||'midnight'));
  $$('#stTheme [data-theme-val]').forEach(b=>b.classList.toggle('on',activeTheme===b.dataset.themeVal));
  $$('#stFs [data-fs-val]').forEach(b=>b.classList.toggle('on',(st.fs||'m')===b.dataset.fsVal));
  const n=$('#stBackupNote');
  if(n){
    n.textContent=backupNoteText();
    const d=backupAgeDays();
    n.classList.toggle('warn',d===null||d>=7);
  }
  const cfg=syncLiveCfg();
  const prov=syncProv(cfg);
  $$('#stSyncProv [data-syncprov-val]').forEach(b=>b.classList.toggle('on',prov===b.dataset.syncprovVal));
  $$('#stSyncAuto [data-syncauto-val]').forEach(b=>b.classList.toggle('on',(cfg.auto?'1':'0')===b.dataset.syncautoVal));
  const g=$('#stSyncGist'),d=$('#stSyncDav');
  if(g) g.classList.toggle('hidden',prov!=='gist');
  if(d) d.classList.toggle('hidden',prov!=='dav');
  fillIfIdle('stGhToken',cfg.ghToken); fillIfIdle('stGhGist',cfg.ghGistId);
  fillIfIdle('stDavUrl',cfg.url); fillIfIdle('stDavUser',cfg.user); fillIfIdle('stDavPass',cfg.pass);
  const box=$('#stSyncStatus');
  if(box){
    const ok=syncReady(cfg);
    if(syncBusy){
      box.textContent='正在同步…';
      box.classList.remove('warn');
    }else if(syncStatusMsg){
      /* 上一次同步的结果（成功/失败）保留在这里，别被普通刷新盖掉 */
      box.textContent=syncStatusMsg;
      box.classList.toggle('warn',syncStatusErr);
    }else{
      let t='';
      if(cfg.lastAt) t='上次同步 '+syncWhen(cfg.lastAt);
      if(!ok) t=(t?t+' · ':'')+syncNeedMsg(cfg);
      if(!t) t='已配置，还没同步过';
      box.textContent=t;
      box.classList.toggle('warn',!ok);
    }
  }
}
/* 刚填好凭据、还从没同步过：自动传一次，省得再点。3 秒内只触发一次，避免重复建 Gist */
let firstSyncAt=0;
function maybeFirstSync(){
  const cfg=syncCfg();
  if(!cfg.auto||!syncReady(cfg)||cfg.lastAt) return;
  const now=Date.now();
  if(now-firstSyncAt<3000) return;
  firstSyncAt=now;
  setTimeout(()=>{ if(!syncBusy) syncNow(false); },400);
}
function syncLiveCfg(){
  const cfg=Object.assign({},syncCfg());
  const val=id=>{ const el=$('#'+id); return el?String(el.value||''):''; };
  if(val('stGhToken').trim()) cfg.ghToken=val('stGhToken').trim();
  if(val('stGhGist').trim()) cfg.ghGistId=val('stGhGist').trim();
  if(val('stDavUrl').trim()) cfg.url=val('stDavUrl').trim();
  if(val('stDavUser').trim()) cfg.user=val('stDavUser').trim();
  if(val('stDavPass')) cfg.pass=val('stDavPass');
  return cfg;
}
function fillIfIdle(id,v){
  const el=$('#'+id);
  if(el&&document.activeElement!==el) el.value=v||'';
}
function grabSyncFields(){
  const cfg=syncCfg();
  /* 空输入框不能覆盖已保存的值：Gist ID 本来就“留空自动新建”，
     以前这里会把刚拿到的 ID 抹成空，导致每同步一次就多建一个 Gist。
     只有用户正聚焦在该框里手动清空，才算真的要删除。 */
  const take=(id,key,mask)=>{
    const el=$('#'+id);
    if(!el) return;
    const v=mask?String(el.value||''):String(el.value||'').trim();
    if(v||document.activeElement===el) cfg[key]=v;
  };
  take('stGhToken','ghToken');
  take('stGhGist','ghGistId');
  take('stDavUrl','url');
  take('stDavUser','user');
  take('stDavPass','pass',true);
  return cfg;
}
const AI_PROVIDER_PRESETS={
  deepseek:{baseUrl:'https://api.deepseek.com',model:'deepseek-flash'},
  doubao:{baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'doubao-seed-2-1-pro-260915'},
  chatgpt:{baseUrl:'https://api.openai.com/v1',model:'gpt-4o-mini'}
};
/* 根据当前接口地址反推服务商（老用户/自定义配置也能正确高亮） */
function detectProvider(){
  const base=String(($('#stBase')&&$('#stBase').value)||(state.settings&&state.settings.baseUrl)||'').toLowerCase();
  if(base.indexOf('ark.cn-beijing')>=0) return 'doubao';
  if(base.indexOf('openai')>=0) return 'chatgpt';
  if(base.indexOf('deepseek')>=0) return 'deepseek';
  return '';
}
function syncProviderCards(){
  const cur=detectProvider();
  $$('#settingsModal [data-prov]').forEach(b=>b.classList.toggle('on',b.dataset.prov===cur));
}
/* ============ 新手分步引导：自绘 SVG 示意图，数据驱动（不怕官网改版） ============ */
const GUIDE_STEPS={
  deepseek:{label:'DeepSeek',url:'https://platform.deepseek.com/',warn:false,
    note:'便宜稳定，充 10 块日常能用很久',
    steps:[
      {kind:'register',img:'deepseek-1.jpeg',text:'浏览器打开平台，用手机号注册并登录'},
      {kind:'menu',img:'deepseek-2.jpeg',text:'登录后在左侧菜单找到并点「API Keys」'},
      {kind:'create',text:'点「创建 API key」，名字随便填，再点创建'},
      {kind:'copy',text:'立刻复制这串 Key（只显示这一次），粘回本 App 保存'}]},
  doubao:{label:'豆包',url:'https://console.volcengine.com/ark',warn:false,
    note:'新用户有免费额度、到量自动停，适合先试手',
    steps:[
      {kind:'register',text:'打开火山方舟，手机号注册，按提示做个人实名'},
      {kind:'menu',text:'在方舟里开通你要用的豆包模型'},
      {kind:'create',text:'左侧「API Key 管理」点「创建 API Key」'},
      {kind:'copy',text:'复制创建好的 Key，粘回本 App 保存'}]},
  chatgpt:{label:'ChatGPT',url:'https://platform.openai.com/',warn:true,
    note:'国内用不了，需海外手机号和支付，新手不推荐',
    steps:[
      {kind:'warn',text:'官方不支持国内直接访问，注册要海外手机号'},
      {kind:'register',text:'若条件具备，访问平台注册并登录账号'},
      {kind:'recharge',text:'先充值余额，否则调用会被拒绝'},
      {kind:'create',text:'创建 API Key 并复制，粘回本 App 保存'}]},
  pixabay:{label:'Pixabay配图',url:'https://pixabay.com/api/docs/',warn:false,
    note:'免费图片密钥，选填；不填也默认用 Openverse 自动找图，找不到可改用截图',
    steps:[
      {kind:'register',img:'pixabay-1.jpeg',text:'打开 Pixabay，点右上角 Log in 注册一个免费账号'},
      {kind:'verify',text:'去邮箱点确认链接，激活账号'},
      {kind:'copy',img:'pixabay-3.jpeg',text:'在 API 文档页看到自己的 Key（绿色框），复制'},
      {kind:'paste',text:'粘回本 App「发音与配图」里的 Pixabay 输入框'}]}
};
/* 每一步的浏览器线框示意图：描边风格，关键操作点用 accent 高亮 */
function guideStepSVG(kind){
  const A='var(--accent)',S3='var(--s3)',S4='var(--s4)',T3='var(--text3)';
  const shell='<svg viewBox="0 0 240 150" class="ag-svg" aria-hidden="true">'+
    '<rect x="6" y="10" width="228" height="132" rx="10" fill="var(--s1)" stroke="var(--sep)" stroke-width="1.5"/>'+
    '<circle cx="21" cy="25" r="2.6" fill="'+S4+'"/><circle cx="31" cy="25" r="2.6" fill="'+S4+'"/><circle cx="41" cy="25" r="2.6" fill="'+S4+'"/>'+
    '<rect x="58" y="18" width="166" height="14" rx="7" fill="'+S3+'"/>'+
    '<line x1="6" y1="40" x2="234" y2="40" stroke="var(--sep)" stroke-width="1.2"/>';
  let b='';
  if(kind==='register'){
    b='<rect x="24" y="52" width="120" height="12" rx="6" fill="'+S3+'"/><rect x="24" y="72" width="120" height="12" rx="6" fill="'+S3+'"/>'+
      '<rect x="24" y="96" width="92" height="30" rx="8" fill="'+A+'"/><text x="70" y="115" text-anchor="middle" font-size="12" fill="#fff" font-weight="700">注册 / 登录</text>';
  }else if(kind==='menu'){
    b='<rect x="20" y="48" width="64" height="86" rx="8" fill="'+S3+'"/><line x1="30" y1="62" x2="74" y2="62" stroke="'+T3+'" stroke-width="3" stroke-linecap="round"/>'+
      '<line x1="30" y1="76" x2="74" y2="76" stroke="'+T3+'" stroke-width="3" stroke-linecap="round"/><rect x="26" y="86" width="52" height="16" rx="5" fill="'+A+'"/>'+
      '<line x1="100" y1="62" x2="216" y2="62" stroke="'+S4+'" stroke-width="3" stroke-linecap="round"/><line x1="100" y1="82" x2="200" y2="82" stroke="'+S4+'" stroke-width="3" stroke-linecap="round"/>'+
      '<line x1="100" y1="102" x2="210" y2="102" stroke="'+S4+'" stroke-width="3" stroke-linecap="round"/>';
  }else if(kind==='create'){
    b='<rect x="158" y="48" width="62" height="22" rx="7" fill="'+A+'"/><text x="189" y="63" text-anchor="middle" font-size="11" fill="#fff" font-weight="700">创建</text>'+
      '<rect x="60" y="86" width="120" height="46" rx="9" fill="'+S3+'" stroke="'+A+'" stroke-width="1.6"/><line x1="74" y1="104" x2="166" y2="104" stroke="'+S4+'" stroke-width="3" stroke-linecap="round"/>'+
      '<line x1="74" y1="120" x2="140" y2="120" stroke="'+S4+'" stroke-width="3" stroke-linecap="round"/>';
  }else if(kind==='copy'){
    b='<rect x="24" y="60" width="150" height="26" rx="7" fill="'+S3+'" stroke="var(--sep)"/><line x1="34" y1="73" x2="160" y2="73" stroke="'+T3+'" stroke-width="3" stroke-linecap="round"/>'+
      '<rect x="182" y="60" width="36" height="26" rx="7" fill="'+A+'"/><text x="200" y="77" text-anchor="middle" font-size="10" fill="#fff" font-weight="700">复制</text>'+
      '<circle cx="200" cy="108" r="13" fill="none" stroke="'+A+'" stroke-width="2"/><path d="M194 108l4 4 8-9" fill="none" stroke="'+A+'" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
  }else if(kind==='paste'){
    b='<rect x="24" y="56" width="192" height="40" rx="8" fill="'+S3+'" stroke="'+A+'" stroke-width="1.6"/><line x1="38" y1="72" x2="120" y2="72" stroke="'+T3+'" stroke-width="3" stroke-linecap="round"/>'+
      '<line x1="38" y1="86" x2="150" y2="86" stroke="'+S4+'" stroke-width="3" stroke-linecap="round"/><rect x="84" y="106" width="72" height="22" rx="7" fill="'+A+'"/>'+
      '<text x="120" y="121" text-anchor="middle" font-size="11" fill="#fff" font-weight="700">粘贴并保存</text>';
  }else if(kind==='verify'){
    b='<rect x="86" y="52" width="68" height="46" rx="8" fill="'+S3+'" stroke="var(--sep)"/><path d="M86 58l34 22 34-22" fill="none" stroke="'+T3+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
      '<rect x="64" y="108" width="112" height="20" rx="7" fill="'+A+'"/><text x="120" y="122" text-anchor="middle" font-size="10.5" fill="#fff" font-weight="700">点确认链接</text>';
  }else if(kind==='recharge'){
    b='<rect x="70" y="56" width="100" height="34" rx="8" fill="'+S3+'" stroke="var(--sep)"/><text x="120" y="78" text-anchor="middle" font-size="13" fill="'+T3+'" font-weight="700">¥</text>'+
      '<rect x="84" y="104" width="72" height="24" rx="8" fill="'+A+'"/><text x="120" y="120" text-anchor="middle" font-size="11" fill="#fff" font-weight="700">充值</text>';
  }else if(kind==='warn'){
    b='<path d="M120 54l34 60h-68z" fill="none" stroke="'+A+'" stroke-width="2.4" stroke-linejoin="round"/><line x1="120" y1="76" x2="120" y2="96" stroke="'+A+'" stroke-width="3" stroke-linecap="round"/>'+
      '<circle cx="120" cy="106" r="2.4" fill="'+A+'"/>';
  }
  return shell+b+'</svg>';
}
let guideActive='deepseek';
function renderGuideTabs(){
  const tabs=$('#agTabs');
  tabs.innerHTML=Object.keys(GUIDE_STEPS).map(k=>
    '<button type="button" class="ag-tab'+(k===guideActive?' on':'')+'" data-gtab="'+k+'" role="tab">'+GUIDE_STEPS[k].label+'</button>').join('');
  tabs.querySelectorAll('.ag-tab').forEach(btn=>btn.addEventListener('click',()=>{
    guideActive=btn.getAttribute('data-gtab');renderGuideTabs();renderGuidePanel();
  }));
}
function renderGuidePanel(){
  const g=GUIDE_STEPS[guideActive];
  const head='<div class="agp-head'+(g.warn?' warn':'')+'"><span>'+g.note+'</span><a href="'+g.url+'" target="_blank" rel="noopener">打开官网 ›</a></div>';
  const steps=g.steps.map((s,i)=>{
    const fig=s.img
      ? '<img class="agp-img" src="guide-assets/'+s.img+'" alt="步骤 '+ (i+1) +' 示意图" loading="lazy">'
      : guideStepSVG(s.kind);
    return '<div class="agp-step"><span class="agp-no">'+(i+1)+'</span><div class="agp-fig">'+fig+'</div><p class="agp-txt">'+s.text+'</p></div>';
  }).join('');
  $('#agPanels').innerHTML='<div class="ag-panel">'+head+steps+'</div>';
}
/* 新手引导卡：首次展开，收起后记住不再主动弹；保留重新打开入口 */
function initApiGuide(){
  const card=$('#apiGuideCard'), tg=$('#apiGuideToggle');
  if(!card||!tg) return;
  const seen=localStorage.getItem(API_GUIDE_KEY)==='1';
  card.classList.toggle('collapsed',seen);
  tg.textContent=seen?'配置帮助':'收起';
  tg.onclick=()=>{
    const collapsed=card.classList.toggle('collapsed');
    if(collapsed){
      localStorage.setItem(API_GUIDE_KEY,'1');
      tg.textContent='配置帮助';
    }else{
      tg.textContent='收起';
    }
  };
  try{ renderGuideTabs(); renderGuidePanel(); }catch(e){ console.error('分步引导渲染失败',e); }
}
function openSettings(){
  $('#stBase').value=state.settings.baseUrl||'';
  $('#stKey').value=state.settings.apiKey||'';
  $('#stModel').value=state.settings.model||'';
  $('#stPexels').value=state.settings.pexelsKey||'';
  $('#stPixabay').value=state.settings.pixabayKey||'';
  $('#stTone').value=state.settings.tone||'friend';
  $$('#settingsModal .st-group').forEach(g=>g.classList.toggle('open',g.id==='stgAi'));
  syncSettingsUI();
  try{ personaSyncUI(); }catch(_){}
  try{ syncProviderCards(); }catch(_){}
  try{ initApiGuide(); }catch(_){}
  try{storageRender();}catch(_){}
  $('#settingsModal').classList.add('show');
}
function saveSettings(){
  state.settings=Object.assign({},state.settings,{
    baseUrl:$('#stBase').value.trim(),apiKey:$('#stKey').value.trim(),model:$('#stModel').value.trim(),
    pexelsKey:$('#stPexels').value.trim(),pixabayKey:$('#stPixabay').value.trim(),tone:$('#stTone').value||'friend',
    theme:state.settings.theme||'midnight',fs:state.settings.fs||'m'});
  save(); applyTheme(); $('#settingsModal').classList.remove('show');
  toast('设置已保存');
  /* 刚配好 AI，顺手把当前打开的词条例句补上 */
  // AI is requested only by an explicit learner action.
}
async function testConn(){
  const base=($('#stBase').value.trim()||'https://api.openai.com/v1').replace(/\/+$/,'');
  const key=$('#stKey').value.trim();
  const model=$('#stModel').value.trim()||'gpt-4o-mini';
  if(!key){ toast('先把 API Key 填上','warn'); return; }
  const btn=$('#stTest'), orig=btn.textContent;
  btn.disabled=true; btn.textContent='测试中…';
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),20000);
  try{
    const res=await fetch(base+'/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
      body:JSON.stringify({model,temperature:0,messages:[{role:'user',content:'Reply with the single word: ok'}]}),
      signal:ctrl.signal
    });
    if(!res.ok){ let t=''; try{ t=await res.text(); }catch(_){} throw new Error('HTTP '+res.status+' '+String(t).slice(0,110)); }
    const d=await res.json();
    const txt=(d&&d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content)||'';
    toast(txt?'连接成功，模型可用':'连接成功，但返回内容为空','ok');
  }catch(err){
    const msg=(err&&err.name==='AbortError')?'请求超时（20 秒）':aiErrText(err);
    toast('连接失败：'+msg,'warn');
  }finally{ clearTimeout(timer); btn.disabled=false; btn.textContent=orig; }
}
function exportData(){
  try{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='english-notes-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    state.meta=state.meta||{};
    state.meta.backupAt=Date.now();
    save();
    syncSettingsUI();
    toast('已导出备份文件');
  }catch(e){ toast('导出失败：'+e.message,'warn'); }
}
function csvCell(v){
  return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';
}
function exportAnki(){
  const words=state.words.slice().sort((a,b)=>a.term.toLowerCase().localeCompare(b.term.toLowerCase()));
  if(!words.length){ toast('表达库还是空的','warn'); return; }
  const rows=[['Front','Back','Tags'].map(csvCell).join(',')];
  words.forEach(w=>{
    const front='<b>'+esc(w.term)+'</b>'+(w.phonetic?'<br><span style="color:#888">'+esc(w.phonetic)+'</span>':'');
    let back='<div style="font-size:16px;line-height:1.7">'+esc(w.definition||'（暂无释义）').replace(/\n/g,'<br>')+'</div>';
    if((w.examples||[]).length){
      back+='<hr>';
      back+=(w.examples||[]).map(x=>'<div style="margin:8px 0"><div>'+esc(x.en)+'</div>'+(x.cn?'<div style="color:#888;font-size:14px">'+esc(x.cn)+'</div>':'')+'</div>').join('');
    }
    if((w.tags||[]).length) back+='<div style="margin-top:8px;color:#888;font-size:13px">#'+w.tags.map(t=>esc(t)).join(' #')+'</div>';
    rows.push([csvCell(front),csvCell(back),csvCell((w.tags||[]).join(' '))].join(','));
  });
  const csv='\ufeff'+rows.join('\r\n');
  try{
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='anki-cards-'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    toast('已导出 '+words.length+' 张 Anki 卡片');
  }catch(e){ toast('导出失败：'+e.message,'warn'); }
}
function importData(file){
  const fr=new FileReader();
  fr.onload=()=>{
    try{
      const d=JSON.parse(fr.result);
      if(!d||!Array.isArray(d.words)||!Array.isArray(d.notes)) throw new Error('不是本应用的备份文件');
      showConfirm({
        title:'导入备份？',
        msg:'将用备份覆盖当前的笔记与生词（'+d.words.length+' 个单词 / '+d.notes.length+' 篇笔记），当前内容会被替换。',
        okText:'导入',danger:true,onOk(){
          state=migrate({folders:Array.isArray(d.folders)?d.folders:[],notes:d.notes,words:d.words,
            aiLog:Array.isArray(d.aiLog)?d.aiLog:[],
            meta:d.meta||{backupAt:null},
            settings:Object.assign({},d.settings||{})});
          save(); applyTheme(); ui.note=null; ui.mode='list'; ui.folder='all'; render();
          $('#settingsModal').classList.remove('show');
          toast('导入完成');
        }
      });
    }catch(e){ toast('导入失败：'+e.message,'warn'); }
  };
  fr.onerror=()=>toast('读取文件失败','warn');
  fr.readAsText(file);
}
function clearSettings(){
  showConfirm({title:'清除 AI 配置？',msg:'清除后，赋能将改用免费词典查询。',okText:'清除',danger:true,onOk(){
    state.settings={baseUrl:'',apiKey:'',model:'',tone:'friend',theme:state.settings.theme||'midnight',fs:state.settings.fs||'m'}; save();
    try{localStorage.removeItem('en-ai-image-v1');}catch(_){ }
    $('#stBase').value=''; $('#stKey').value=''; $('#stModel').value=''; $('#stTone').value='friend';
    try{ syncProviderCards(); }catch(_){}
    $('#settingsModal').classList.remove('show');
    toast('已清除配置');
  }});
}

/* ============ 确认弹窗 / 提示 ============ */
let confirmCb=null;
function showConfirm(opt){
  $('#cfTitle').textContent=opt.title;
  $('#cfMsg').textContent=opt.msg||'';
  $('#cfMsg').style.padding='';
  $('#cfOk').textContent=opt.okText||'确定';
  $('#cfOk').classList.toggle('danger',!!opt.danger);
  confirmCb=opt.onOk||null;
  $('#confirmModal').classList.add('show');
}
function closeConfirm(){ $('#confirmModal').classList.remove('show'); confirmCb=null; }
let toastTimer=null;
function toast(msg,type){
  const t=$('#toast'); t.textContent=msg;
  t.className='show'+(type==='warn'?' warn':'');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{ t.className=''; },3000);
}

/* ============ 表达库批量操作 ============ */
function handleBatch(kind){
  const list=filteredWords();
  const sel=ui.sel.map(id=>state.words.find(w=>w.id===id)).filter(Boolean);
  if(kind==='exit'){ ui.selMode=false; ui.sel=[]; renderPane(); return; }
  if(kind==='all'){
    ui.sel=(ui.sel.length===list.length)?[]:list.map(w=>w.id);
    renderPane(); return;
  }
  if(!sel.length){ toast('先在卡片上点选单词','warn'); return; }
  if(kind==='tag'){
    const names=tagNames();
    if(!names.length){
      toast('先去「标签聚合」建几个标签类别','warn');
      ui.mode='tags'; ui.tagNewOpen=true; render();
      return;
    }
    showConfirm({title:'批量打标签',msg:'',okText:'应用'});
    const msg=$('#cfMsg');
    msg.style.padding='12px 20px 0';
    const picked=new Set();
    const draw=()=>{
      msg.innerHTML='<div class="pick-tags">'+names.map(t=>'<button type="button" class="pick-chip'+(picked.has(t)?' on':'')+'" data-pick="'+esc(t)+'">'+(picked.has(t)?'✓ ':'')+'# '+esc(t)+'</button>').join('')+'</div>';
    };
    draw();
    msg.onclick=e=>{
      const b=e.target.closest('[data-pick]');
      if(!b) return;
      const t=b.dataset.pick;
      if(picked.has(t)) picked.delete(t); else picked.add(t);
      draw();
    };
    confirmCb=()=>{
      if(!picked.size){ toast('至少选一个标签','warn'); return; }
      const arr=[...picked];
      sel.forEach(w=>{ w.tags=[...new Set([...(w.tags||[]),...arr])]; w.updatedAt=Date.now(); });
      arr.forEach(putTag);
      save(); render(); toast('已为 '+sel.length+' 个单词打上 '+arr.map(t=>'#'+t).join(' '));
    };
    return;
  }
  if(kind==='ex'){
    const need=sel.filter(w=>!(w.examples&&w.examples.length));
    batchGenExamples(need.length?need:sel);
    return;
  }
  if(kind==='master'){
    sel.forEach(w=>{ const s=ensureSrs(w); s.box=6; w.mastered=true; w.updatedAt=Date.now(); });
    save(); render(); toast('已标记 '+sel.length+' 个为已掌握');
    return;
  }
  if(kind==='del'){
    showConfirm({
      title:'删除 '+sel.length+' 个单词？',msg:'例句和练习记录里的引用会一并移除，删除后无法恢复。',
      okText:'删除',danger:true,onOk(){
        const ids=new Set(sel.map(w=>w.id));
        ids.forEach(id=>addGrave('word',id));
        state.words=state.words.filter(w=>!ids.has(w.id));
        ui.sel=[];
        save(); render(); toast('已删除 '+ids.size+' 个单词');
      }
    });
  }
}
/* ============ 侧边栏滑动关闭 ============ */
function bindSideSwipe(){
  const sb=$('#sidebar');
  if(!sb) return;
  let x0=0,y0=0,dx=0,on=false;
  sb.addEventListener('touchstart',e=>{
    if(window.innerWidth>=768||!ui.sideOpen) return;
    const t=e.touches[0]; x0=t.clientX; y0=t.clientY; dx=0; on=true;
    sb.style.transition='none';
  },{passive:true});
  sb.addEventListener('touchmove',e=>{
    if(!on) return;
    const t=e.touches[0];
    const ddx=t.clientX-x0, ddy=t.clientY-y0;
    if(Math.abs(ddy)>Math.abs(ddx)&&Math.abs(ddy)>12){ on=false; sb.style.transition=''; sb.style.transform=''; return; }
    dx=Math.min(0,ddx);
    sb.style.transform='translateX('+dx+'px)';
  },{passive:true});
  sb.addEventListener('touchend',()=>{
    if(!on) return;
    on=false;
    sb.style.transition='';
    sb.style.transform='';
    if(dx<-60){ ui.sideOpen=false; render(); }
  },{passive:true});
}
/* ============ 主页面跟手左右滑 ============ */
const PAGE_SWIPE_MODES=['today','list','words','flash'];
function pageSwipeBlocked(target){
  if(ui.sideOpen)return true;
  if(PAGE_SWIPE_MODES.indexOf(ui.mode)<0)return true;
  /* 任何浮层打开时不抢手势 */
  if(document.querySelector('.modal.show,.ai-page.show,#shotViewer.show,#qdSheet.show,#writeModal.show,.bottom-sheet.show,#noteOrganize.show,#dictPage.show,#followPage.show'))return true;
  /* 起点落在可横向滑动的元素（图片轮播/横滚条），让它自己处理 */
  if(target.closest&&target.closest('[data-no-swipe],.hscroll,.carousel,.wm-shots,.shot-strip,.img-swipe'))return true;
  return false;
}
/* 切到指定主页面：字段重置与底部 tab 点击保持一致 */
function applyPageMode(k){
  try{ persistEditor(); }catch(_){}
  if(k==='today'){ui.mode='today';ui.note=null;ui.tag=null;}
  else if(k==='list'){ui.mode='list';ui.folder='all';ui.note=null;ui.tag=null;}
  else if(k==='words'){ui.mode='words';ui.note=null;ui.selMode=false;ui.sel=[];ui.wordFilter='all';ui.wordTag='';}
  else if(k==='flash'){ui.mode='flash';ui.note=null;ui.flash=null;}
  ui.sideOpen=false;
  render();
}
function bindPageSwipe(){
  const pane=$('#noteListPane');
  if(!pane)return;
  let x0=0,y0=0,dx=0,locked=0,on=false;
  pane.addEventListener('touchstart',e=>{
    on=false;locked=0;dx=0;
    if(firstGuideStep||pageSwipeBlocked(e.target))return;
    const t=e.touches[0];
    /* 左边缘起滑交给边缘抽屉手势，页面横滑不抢 */
    if(t.clientX<=EDGE_ZONE)return;
    x0=t.clientX;y0=t.clientY;on=true;
  },{passive:true});
  pane.addEventListener('touchmove',e=>{
    if(!on)return;
    const t=e.touches[0];
    const ddx=t.clientX-x0,ddy=t.clientY-y0;
    if(!locked){
      if(Math.abs(ddx)<8&&Math.abs(ddy)<8)return;
      if(Math.abs(ddy)>Math.abs(ddx)){on=false;return;}   /* 纵向滚动，放行不拦截 */
      locked=1;pane.style.transition='none';
    }
    const idx=PAGE_SWIPE_MODES.indexOf(ui.mode);
    let x=ddx;
    /* 到头（第一个不能再往右、最后一个不能再往左）加阻尼 */
    if((x>0&&idx<=0)||(x<0&&idx>=PAGE_SWIPE_MODES.length-1))x=x*0.3;
    dx=x;
    pane.style.transform='translateX('+x+'px)';
    pane.style.opacity=String(Math.max(.78,1-Math.abs(x)/(window.innerWidth*1.4)));
  },{passive:true});
  pane.addEventListener('touchend',()=>{
    if(!on||!locked){on=false;return;}
    on=false;
    const w=window.innerWidth,idx=PAGE_SWIPE_MODES.indexOf(ui.mode),goNext=dx<0;
    const passed=Math.abs(dx)>w*0.15;
    let target=idx;
    if(passed){
      if(goNext&&idx<PAGE_SWIPE_MODES.length-1)target=idx+1;
      else if(!goNext&&idx>0)target=idx-1;
    }
    pane.style.transition='transform .22s ease,opacity .22s ease';
    if(target===idx){
      pane.style.transform='';pane.style.opacity='';
      setTimeout(()=>{pane.style.transition='';pane.style.transform='';pane.style.opacity='';},240);
    }else{
      pane.style.transform='translateX('+(goNext?-w:w)+'px)';
      setTimeout(()=>{
        pane.style.transition='none';pane.style.transform='';pane.style.opacity='';
        applyPageMode(PAGE_SWIPE_MODES[target]);
      },200);
    }
  },{passive:true});
}
/* ============ 底部 tabbar 横滑切换 ============ */
function bindTabbarSwipe(){
  const bar=$('#tabbar'),pane=$('#noteListPane');
  if(!bar)return;
  let x0=0,y0=0,dx=0,locked=0,on=false;
  bar.addEventListener('touchstart',e=>{
    on=false;locked=0;dx=0;
    if(firstGuideStep||ui.sideOpen||ui.mode==='edit')return;
    if(PAGE_SWIPE_MODES.indexOf(ui.mode)<0)return;
    x0=e.touches[0].clientX;y0=e.touches[0].clientY;on=true;
  },{passive:true});
  bar.addEventListener('touchmove',e=>{
    if(!on)return;
    const t=e.touches[0],ddx=t.clientX-x0,ddy=t.clientY-y0;
    if(!locked){
      if(Math.abs(ddx)<8&&Math.abs(ddy)<8)return;
      if(Math.abs(ddy)>Math.abs(ddx)){on=false;return;}
      locked=1;if(pane)pane.style.transition='none';
    }
    const idx=PAGE_SWIPE_MODES.indexOf(ui.mode);
    let x=ddx;
    if((x>0&&idx<=0)||(x<0&&idx>=PAGE_SWIPE_MODES.length-1))x=x*0.3;
    dx=x;
    if(pane){
      pane.style.transform='translateX('+x+'px)';
      pane.style.opacity=String(Math.max(.78,1-Math.abs(x)/(window.innerWidth*1.4)));
    }
  },{passive:true});
  bar.addEventListener('touchend',()=>{
    if(!on){on=false;return;}
    on=false;
    if(!locked||!pane){locked=0;return;}
    locked=0;
    const w=window.innerWidth,idx=PAGE_SWIPE_MODES.indexOf(ui.mode),goNext=dx<0;
    const passed=Math.abs(dx)>=25;
    let target=idx;
    if(passed){
      if(goNext&&idx<PAGE_SWIPE_MODES.length-1)target=idx+1;
      else if(!goNext&&idx>0)target=idx-1;
    }
    pane.style.transition='transform .22s ease,opacity .22s ease';
    if(target===idx){
      pane.style.transform='';pane.style.opacity='';
      setTimeout(()=>{pane.style.transition='';pane.style.transform='';pane.style.opacity='';},240);
    }else{
      pane.style.transform='translateX('+(goNext?-w:w)+'px)';
      setTimeout(()=>{
        pane.style.transition='none';pane.style.transform='';pane.style.opacity='';
        applyPageMode(PAGE_SWIPE_MODES[target]);
      },200);
    }
  },{passive:true});
}
/* ============ 编辑器左滑退出（跟手） ============ */
function bindEditorSwipe(){
  const pane=$('#noteListPane');
  if(!pane)return;
  let x0=0,y0=0,dx=0,locked=0,on=false;
  pane.addEventListener('touchstart',e=>{
    on=false;locked=0;dx=0;
    if(firstGuideStep||ui.mode!=='edit'||ui.sideOpen)return;
    if(document.querySelector('.modal.show,.ai-page.show,#shotViewer.show'))return;
    const tg=e.target;
    if(tg.closest&&tg.closest('[data-no-swipe],.hscroll,.carousel,.wm-shots,.shot-strip,.img-swipe,.en-word,.nh'))return;
    const t=e.touches[0];x0=t.clientX;y0=t.clientY;on=true;
  },{passive:true});
  pane.addEventListener('touchmove',e=>{
    if(!on)return;
    const t=e.touches[0],ddx=t.clientX-x0,ddy=t.clientY-y0;
    if(!locked){
      if(Math.abs(ddx)<8&&Math.abs(ddy)<8)return;
      if(Math.abs(ddy)>Math.abs(ddx)){on=false;return;}
      locked=1;pane.style.transition='none';
    }
    dx=Math.min(0,ddx);
    pane.style.transform='translateX('+dx+'px)';
    pane.style.opacity=String(Math.max(.78,1-Math.abs(dx)/(window.innerWidth*1.4)));
  },{passive:true});
  pane.addEventListener('touchend',()=>{
    if(!on||!locked){on=false;return;}
    on=false;
    const w=window.innerWidth,go=dx<-w*0.22;
    pane.style.transition='transform .22s ease,opacity .22s ease';
    if(go){
      pane.style.transform='translateX(-'+w+'px)';pane.style.opacity='.8';
      setTimeout(()=>{
        pane.style.transition='none';pane.style.transform='';pane.style.opacity='';
        backToList();
      },200);
    }else{
      pane.style.transform='';pane.style.opacity='';
      setTimeout(()=>{pane.style.transition='';pane.style.transform='';pane.style.opacity='';},240);
    }
  },{passive:true});
}
/* ============ 左边缘右滑：跟手拉出「更多」抽屉 ============ */
const EDGE_ZONE=24;
function edgeSwipeAllowed(target){
  if(ui.sideOpen)return false;
  if(PAGE_SWIPE_MODES.indexOf(ui.mode)<0)return false;
  if(document.querySelector('.modal.show,.ai-page.show,#shotViewer.show,#qdSheet.show,#writeModal.show,.bottom-sheet.show,#noteOrganize.show,#dictPage.show,#followPage.show'))return false;
  if(target.closest&&target.closest('[data-no-swipe],.hscroll,.carousel,.wm-shots,.shot-strip,.img-swipe'))return false;
  return true;
}
function bindEdgeDrawerSwipe(){
  const pane=$('#noteListPane'),bar=$('#sidebar'),scrim=$('#scrim');
  if(!pane||!bar)return;
  let x0=0,y0=0,dx=0,locked=0,on=false,dw=300;
  pane.addEventListener('touchstart',e=>{
    on=false;locked=0;dx=0;
    const t=e.touches[0];
    if(t.clientX>EDGE_ZONE)return;
    if(firstGuideStep||!edgeSwipeAllowed(e.target))return;
    x0=t.clientX;y0=t.clientY;dw=bar.offsetWidth||300;on=true;
    bar.style.transition='none';
  },{passive:true});
  pane.addEventListener('touchmove',e=>{
    if(!on)return;
    const t=e.touches[0],ddx=t.clientX-x0,ddy=t.clientY-y0;
    if(!locked){
      if(Math.abs(ddx)<8&&Math.abs(ddy)<8)return;
      if(Math.abs(ddy)>Math.abs(ddx)||ddx<=0){on=false;return;}
      locked=1;
      scrim.style.display='block';
      scrim.style.transition='none';
    }
    dx=Math.max(0,Math.min(dw,ddx));
    const p=dx/dw;
    bar.style.transform='translateX('+(-dw+dx)+'px)';
    scrim.style.opacity=String(p*0.5);
  },{passive:true});
  pane.addEventListener('touchend',()=>{
    if(!on){on=false;return;}
    on=false;
    const open=locked&&dx>dw*0.35;
    if(open){
      try{persistEditor();}catch(_){}
      ui.sideOpen=true;render();
      bar.style.transition='';
      requestAnimationFrame(()=>{
        bar.style.transform='';
        scrim.style.display='';scrim.style.opacity='';
      });
    }else{
      bar.style.transition='transform .22s ease';
      bar.style.transform='translateX(-102%)';
      scrim.style.transition='opacity .22s ease';
      scrim.style.opacity='0';
      setTimeout(()=>{
        bar.style.transition='';bar.style.transform='';
        scrim.style.transition='';scrim.style.display='';scrim.style.opacity='';
      },230);
    }
  },{passive:true});
}
/* ============ 备份提醒 ============ */
let backupWarned=false;
function backupReminder(){
  if(backupWarned) return;
  if(state.words.length<10) return;
  const d=backupAgeDays();
  if(d===null||d>=7){
    backupWarned=true;
    toast(d===null?'还没备份过：设置里可导出备份，避免清缓存丢数据':'距上次备份已 '+d+' 天，建议到设置里导出一次','warn');
  }
}

/* ============ 事件绑定 ============ */
/* ============ 编辑器外观下拉：配色 + 字体，实时切换，不离开页面 ============ */
const LOOK_COLOR_LABEL={sky:'晴空蓝',mint:'薄荷绿',amber:'暖琥珀',lilac:'丁香紫',pearl:'珍珠白',capsule:'胶囊'};
const LOOK_FONT_LABEL={system:'系统默认',serif:'衬线',rounded:'圆润',mono:'等宽'};
function initLookPop(){
  const pop=$('#lookPop'),btn=$('#btnLook'),colorBox=$('#lookColors'),fontBox=$('#fontChoices');
  colorBox.innerHTML=WORD_COLORS.map(c=>
    '<button type="button" class="look-color" data-c="'+c+'" aria-label="'+LOOK_COLOR_LABEL[c]+'"><span class="lc-dot lc-'+c+'"></span><small>'+LOOK_COLOR_LABEL[c]+'</small></button>').join('');
  fontBox.innerHTML=FONT_CHOICES.map(f=>'<button type="button" class="look-font" data-f="'+f+'">'+LOOK_FONT_LABEL[f]+'</button>').join('');
  function syncLook(){
    const cc=getWordColor();
    fontBox.querySelectorAll('[data-f]').forEach(b=>b.classList.toggle('on',b.dataset.f===getFontChoice()));
    colorBox.querySelectorAll('.look-color').forEach(b=>b.classList.toggle('on',b.getAttribute('data-c')===cc));
  }
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    if(pop.hidden){ syncLook();pop.hidden=false; }else pop.hidden=true;
  });
  pop.addEventListener('click',e=>e.stopPropagation());
  fontBox.addEventListener('click',e=>{
    const b=e.target.closest('[data-f]');if(!b)return;
    setFontChoice(b.dataset.f);syncLook();
  });
  colorBox.addEventListener('click',e=>{
    const b=e.target.closest('.look-color');if(!b)return;
    setWordColor(b.getAttribute('data-c'));syncLook();
  });
  document.addEventListener('pointerdown',e=>{
    if(!pop.hidden&&!pop.contains(e.target)&&!btn.contains(e.target))pop.hidden=true;
  });
}
function bindEvents(){
  try{ initLookPop(); }catch(e){ console.error('外观面板初始化失败',e); }
  initEditorBar();
  /* 侧边栏 */
  $('#btnNewFolder').addEventListener('click',()=>{
    showConfirm({title:'新建文件夹',msg:'',okText:'创建',danger:false,onOk:null});
    const msg=$('#cfMsg');
    msg.innerHTML='<input id="cfInput" placeholder="文件夹名称" style="width:100%;border:1px solid var(--s5);border-radius:10px;padding:11px 12px;font-size:16px;background:var(--s0);color:var(--text);box-sizing:border-box">';
    msg.style.padding='12px 20px 0';
    const inp=msg.querySelector('#cfInput');
    setTimeout(()=>inp.focus(),60);
    confirmCb=()=>{
      const name=inp.value.trim();
      if(!name){ toast('请输入文件夹名称','warn'); $('#btnNewFolder').click(); return; }
      createFolder(name);
      render();
      toast('已创建文件夹');
    };
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#cfOk').click(); } });
  });
  $('#btnSettings').addEventListener('click',openSettings);
  /* empower 操作演示：笔记页顶部常驻入口 */
  $('#btnEmpowerGuide').addEventListener('click',()=>$('#empowerDemoModal').classList.add('show'));
  $('#btnInbox').addEventListener('click',()=>ocrInboxShow());
  $('#empowerDemoClose').addEventListener('click',()=>$('#empowerDemoModal').classList.remove('show'));
  $('#empowerDemoModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) e.currentTarget.classList.remove('show'); });
  $('#stClose').addEventListener('click',()=>$('#settingsModal').classList.remove('show'));
  $('#stSave').addEventListener('click',saveSettings);
  /* 设置分组：手风琴，点开一个就收起别的。
     用事件委托绑在弹窗上：动态插入的分组（如账号）也能响应，不依赖初始化时序。 */
  $('#settingsModal').addEventListener('click',e=>{
    const h=e.target.closest('.st-g-head');
    if(!h) return;
    const g=h.parentElement;
    const open=g.classList.contains('open');
    $$('#settingsModal .st-group').forEach(x=>x.classList.remove('open'));
    if(!open) g.classList.add('open');
  });
  $('#stCodeGen').addEventListener('click',syncCodeMake);
  $('#stCodeCopy').addEventListener('click',syncCodeCopy);
  $('#stCodeShare').addEventListener('click',syncCodeShare);
  $('#stCodeApply').addEventListener('click',syncCodeApply);
  $('#stTest').addEventListener('click',testConn);
  $('#stExport').addEventListener('click',exportData);
  $('#stImport').addEventListener('click',()=>$('#stImportFile').click());
  $('#stImportFile').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];
    e.target.value='';
    if(f) importData(f);
  });
  $$('#settingsModal [data-prov]').forEach(b=>b.addEventListener('click',()=>{
    const p=AI_PROVIDER_PRESETS[b.dataset.prov];
    if(!p) return;
    $('#stBase').value=p.baseUrl;
    $('#stModel').value=p.model;
    syncProviderCards();
    toast('已选 '+b.querySelector('.prov-name').textContent+'，只需粘贴 API Key','warn');
  }));
  /* 高级设置折叠 */
  const advT=$('#advToggle');
  if(advT) advT.addEventListener('click',()=>{
    advT.closest('.adv-wrap').classList.toggle('open');
  });
  $('#stClear').addEventListener('click',clearSettings);
  $$('#stTheme [data-theme-val]').forEach(b=>b.addEventListener('click',()=>{
    state.settings.theme=b.dataset.themeVal; save(); applyTheme(); syncSettingsUI();
  }));
  $$('#stFs [data-fs-val]').forEach(b=>b.addEventListener('click',()=>{
    state.settings.fs=b.dataset.fsVal; save(); applyTheme(); syncSettingsUI();
  }));
  $('#stAnki').addEventListener('click',exportAnki);
  /* 云同步 */
  $$('#stSyncProv [data-syncprov-val]').forEach(b=>b.addEventListener('click',()=>{
    const cfg=grabSyncFields();
    cfg.provider=b.dataset.syncprovVal==='dav'?'dav':'gist';
    save(); syncSettingsUI();
  }));
  $$('#stSyncAuto [data-syncauto-val]').forEach(b=>b.addEventListener('click',()=>{
    const cfg=grabSyncFields();
    cfg.auto=b.dataset.syncautoVal==='1';
    save(); syncSettingsUI();
    toast(cfg.auto?'已开启自动同步（改完 5 秒内上传）':'已改为手动同步');
  }));
  ['stGhToken','stGhGist','stDavUrl','stDavUser','stDavPass'].forEach(id=>{
    const el=$('#'+id);
    if(!el) return;
    /* 边打边保存：手机上打完 token 直接点按钮也不会丢 */
    el.addEventListener('input',()=>{
      syncStatusMsg=''; syncStatusErr=false;
      syncSettingsUI();
      clearTimeout(syncTypingTimer);
      syncTypingTimer=setTimeout(()=>{ grabSyncFields(); save(); maybeFirstSync(); },600);
    });
    el.addEventListener('change',()=>{
      grabSyncFields(); save(); syncSettingsUI();
      maybeFirstSync();
    });
  });
  $('#stSyncNow').addEventListener('click',()=>{
    const cfg=grabSyncFields();
    save(true);
    if(!syncReady(cfg)){
      toast(cfg.provider==='gist'?'先填 GitHub Token（要勾 gist 权限）':'先填云端地址','warn');
      return;
    }
    syncSettingsUI();
    syncNow(true);
  });
  $('#sideNav').addEventListener('click',e=>{
    const fmore=e.target.closest('[data-fmore]');
    if(fmore){ e.stopPropagation(); openFolderMenu(fmore.dataset.fmore); return; }
    const f=e.target.closest('[data-folder]');
    if(f){ persistEditor(); ui.folder=f.dataset.folder; ui.note=null; ui.mode='list'; ui.tag=null; ui.sideOpen=false; render(); return; }
    const nav=e.target.closest('[data-nav]');
    if(!nav) return;
    const k=nav.dataset.nav;
    persistEditor();
    if(k==='today'){ ui.mode='today'; }
    else if(k==='all'){ ui.mode='list'; ui.folder='all'; }
    else if(k==='words'){ ui.mode='words'; ui.wordFilter='all'; ui.wordTag=''; }
    else if(k==='tags'){ ui.mode='tags'; }
    else if(k==='flash'){ ui.mode='flash'; ui.flash=null; }
    else if(k==='speak'){ ui.mode='speak'; }
    else if(k==='write-history'){ ui.sideOpen=false; render(); try{openWriteHistory();}catch(_){} return; }
    if(ui.mode!=='words'){ ui.selMode=false; ui.sel=[]; }
    ui.note=null; ui.tag=null; ui.sideOpen=false;
    render();
  });
  $('#scrim').addEventListener('click',()=>{ ui.sideOpen=false; render(); });
  $('#btnMenu').addEventListener('click',()=>{ ui.sideOpen=true; render(); });

  /* 行菜单 + 删除撤销 */
  $('#rowMenuBody').addEventListener('click',e=>{
    const b=e.target.closest('[data-rmi]');
    if(!b) return;
    const it=rowMenuItems&&rowMenuItems[+b.dataset.rmi];
    closeRowMenu();
    if(it&&it.act) setTimeout(()=>{ try{ it.act(); }catch(_){ } },20);
  });
  $('#rowMenu').addEventListener('click',e=>{ if(e.target.id==='rowMenu') closeRowMenu(); });
  $('#undoBtn').addEventListener('click',runUndo);

  /* 底部导航：笔记 / 表达库 / 复习 / 更多 */
  $('#tabbar').addEventListener('click',e=>{
    const t=e.target.closest('[data-tab]');
    if(!t) return;
    const k=t.dataset.tab;
    if(k==='list'&&firstShotNotes())return;
    if(k==='more'){ ui.sideOpen=true; render(); firstShotMoreOpened(); return; }
    persistEditor();
    if(k==='today'){ ui.mode='today'; ui.note=null; ui.tag=null; }
    else if(k==='list'){ ui.mode='list'; ui.folder='all'; ui.note=null; ui.tag=null; }
    else if(k==='words'){ ui.mode='words'; ui.note=null; ui.selMode=false; ui.sel=[]; ui.wordFilter='all'; ui.wordTag=''; }
    else if(k==='flash'){ ui.mode='flash'; ui.note=null; ui.flash=null; }
    ui.sideOpen=false;
    render();
  });

  /* 内容区 */
  $('#btnNewNote').addEventListener('click',newNote);
  $('#globalSearch').addEventListener('input',e=>{
    const q=e.target.value.trim();
    ui.search=q;
    $('#searchClear').classList.toggle('hidden',!q);
    if(q&&ui.mode!=='search'){ ui.prevMode=ui.mode; ui.mode='search'; ui.selMode=false; ui.sel=[]; }
    if(!q&&ui.mode==='search'){ ui.mode=ui.prevMode||'list'; }
    render();
  });
  $('#searchClear').addEventListener('click',()=>{
    $('#globalSearch').value=''; ui.search=''; $('#searchClear').classList.add('hidden');
    if(ui.mode==='search'){ ui.mode=ui.prevMode||'list'; }
    render();
  });
  document.addEventListener('click',e=>{
    const play=e.target.closest('[data-play]');
    if(play){
      const t=play.getAttribute('data-play'),lg=play.getAttribute('data-play-lang')||'en-US';
      if(play.getAttribute('data-play-kind')==='word') speakWord(t); else speak(t,lg);
      return;
    }
    const fixex=e.target.closest('[data-fixex]');
    if(fixex){
      const w=state.words.find(x=>x.id===fixex.dataset.fixex);
      if(w) batchGenExamples([w]);
      return;
    }
    const srnote=e.target.closest('[data-srnote]');
    if(srnote){ jumpToNote(srnote.dataset.srnote); return; }
    const logItem=e.target.closest('[data-log]');
    if(logItem){
      const rec=(state.aiLog||[]).find(x=>x.id===logItem.dataset.log);
      if(rec) openAiPractice(rec.term,{title:rec.scene||'自由练习',desc:rec.sceneDesc||''});
      return;
    }
    const batchBtn=e.target.closest('[data-batch]');
    if(batchBtn){ handleBatch(batchBtn.dataset.batch); return; }
    if(e.target.closest('#wbSelMode')){
      ui.selMode=!ui.selMode; ui.sel=[]; renderPane(); return;
    }
    const mbtn=e.target.closest('[data-master]');
    if(mbtn){
      const w=state.words.find(x=>x.id===mbtn.dataset.master);
      if(w){ w.mastered=!w.mastered; w.updatedAt=Date.now(); save(); render(); }
      return;
    }
    const wf=e.target.closest('[data-wfilter]');
    if(wf){ ui.wordFilter=wf.dataset.wfilter; if(ui.wordFilterOpen)wfCloseSheet();render(); return; }
    const npin=e.target.closest('[data-npin]');
    if(npin){ e.stopPropagation(); toggleNotePin(npin.dataset.npin); return; }
    const wlink=e.target.closest('[data-wlink]');
    if(wlink){ e.stopPropagation(); jumpToNote(wlink.dataset.wlink); return; }
    const chip=e.target.closest('[data-chip]');
    if(chip){
      const t=chip.dataset.chip;
      ui.mode='tags'; ui.tag=t; ui.sideOpen=false; render();
      return;
    }
    if(e.target.closest('#tagNewBtn')){ ui.tagNewOpen=!ui.tagNewOpen; renderPane(); return; }
    if(e.target.closest('#tagEditBtn')){ ui.tagEdit=!ui.tagEdit; renderPane(); return; }
    if(e.target.closest('#tagNameOk')){ addTagFromPane(); return; }
    const tgedit=e.target.closest('[data-tg-edit]');
    if(tgedit){ e.stopPropagation(); renameTagDialog(tgedit.dataset.tgEdit); return; }
    const tgdel=e.target.closest('[data-tg-del]');
    if(tgdel){ e.stopPropagation(); deleteTagDialog(tgdel.dataset.tgDel); return; }
    const tag=e.target.closest('[data-tag]');
    if(tag){
      const t=tag.dataset.tag;
      ui.tag=(ui.tag===t)?null:t; render();
      return;
    }
    const clear=e.target.closest('#tagClear');
    if(clear){ ui.tag=null; render(); return; }
    const wshot=e.target.closest('[data-wshot]');
    if(wshot){
      e.stopPropagation();
      const wid=wshot.dataset.wshot;
      const w=state.words.find(x=>x.id===wid);
      openShotViewerFor(w?w.term:'',Number(wshot.dataset.shoti));
      return;
    }
    const card=e.target.closest('[data-wid]');
    if(card){
      if(ui.selMode){
        const id=card.dataset.wid;
        const i=ui.sel.indexOf(id);
        if(i>=0) ui.sel.splice(i,1); else ui.sel.push(id);
        renderPane();
        return;
      }
      const w=state.words.find(x=>x.id===card.dataset.wid);
      if(w) openWordModal(w.term,null,null,w);
      return;
    }
    const item=e.target.closest('[data-note]');
    if(item){ if(noteLpFired){ noteLpFired=false; return; } openNote(item.dataset.note); }
  });

  /* 长按笔记项 → 弹出置顶/删除菜单 */
  let noteLpFired=false, noteLpTimer=0, noteLpEl=null;
  $('#noteList').addEventListener('touchstart',e=>{
    const item=e.target.closest('[data-note]');
    if(!item) return;
    noteLpEl=item;
    clearTimeout(noteLpTimer);
    noteLpTimer=setTimeout(()=>{
      if(noteLpEl){ noteLpFired=true; openNoteMenu(noteLpEl.dataset.note); noteLpEl=null; try{ if(navigator.vibrate) navigator.vibrate(10); }catch(_){} }
    },500);
  },{passive:true});
  const cancelNoteLp=()=>{ clearTimeout(noteLpTimer); noteLpEl=null; };
  $('#noteList').addEventListener('touchend',cancelNoteLp,{passive:true});
  $('#noteList').addEventListener('touchmove',cancelNoteLp,{passive:true});

  /* 表达库：排序与标签筛选 */
  $('#noteList').addEventListener('keydown',e=>{
    if(e.target&&e.target.id==='tagNameInput'&&e.key==='Enter'){ e.preventDefault(); addTagFromPane(); }
  });
  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.id==='wbSort'){ ui.wordSort=t.value; if(ui.wordFilterOpen)wfCloseSheet();renderPane(); return; }
    if(t.id==='wbTag'){ ui.wordTag=t.value; if(ui.wordFilterOpen)wfCloseSheet();renderPane(); return; }
    if(t.id==='wbNote'){ ui.wordNote=t.value; if(ui.wordFilterOpen)wfCloseSheet();renderPane(); return; }
  });

  /* 编辑器 */
  $('#btnBack').addEventListener('click',backToList);
  $('#btnHistUndo').addEventListener('click',histUndo);
  $('#btnNoteOrganize').addEventListener('click',openNoteOrganize);
  $('#noteOrganizeClose').addEventListener('click',closeNoteOrganize);
  $('#noteOrganize').addEventListener('click',e=>{
    if(e.target.id==='noteOrganize'){ closeNoteOrganize(); return; }
    const b=e.target.closest('[data-note-organize-word]');
    if(b){ const w=state.words.find(x=>x.id===b.dataset.noteOrganizeWord); if(w){ closeNoteOrganize(); openWordModal(w.term,null,null,w); } }
  });
  $('#noteOrganizeWordsBtn').addEventListener('click',()=>{ closeNoteOrganize(); ui.mode='words'; ui.note=null; ui.wordFilter='all'; ui.wordTag=''; ui.selMode=false; ui.sel=[]; render(); });
  $('#noteOrganizeFlashBtn').addEventListener('click',()=>{ closeNoteOrganize(); ui.mode='flash'; ui.note=null; ui.flash=null; render(); });
  titleEl.addEventListener('input',onEditorInput);
  bodyEl.addEventListener('input',onEditorInput);
  bodyEl.addEventListener('paste',e=>{
    e.preventDefault();
    const text=(e.clipboardData||window.clipboardData).getData('text/plain');
    document.execCommand('insertText',false,text);
    onEditorInput();
  });
  /* 随时退出都不丢内容与位置：离开页面/切后台前立即落盘 */
  const flushNow=()=>{ if(saveTimer){ clearTimeout(saveTimer); saveTimer=null; } persistEditor(); };
  window.addEventListener('pagehide',flushNow);
  window.addEventListener('beforeunload',flushNow);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushNow(); });
  titleEl.addEventListener('mouseup',scheduleCheck);
  bodyEl.addEventListener('mouseup',scheduleCheck);
  titleEl.addEventListener('touchend',scheduleCheck);
  bodyEl.addEventListener('touchend',scheduleCheck);
  titleEl.addEventListener('keyup',scheduleCheck);
  bodyEl.addEventListener('keyup',scheduleCheck);
  bodyEl.addEventListener('keydown',handleWordCaretKey);
  /* 大标题：回车往下回到正文，行首退格变回正文 */
  bodyEl.addEventListener('keydown',e=>{
    if(e.isComposing) return;
    const b=blockAtCaret();
    if(!b||!isHead(b)) return;
    if(e.key==='Enter'&&!e.shiftKey){
      e.preventDefault();
      const div=document.createElement('div');
      div.appendChild(document.createElement('br'));
      b.parentNode.insertBefore(div,b.nextSibling);
      caretTo(div);
      applyFolds();
      onEditorInput();
      return;
    }
    if(e.key==='Backspace'&&caretAtStart(b)){
      e.preventDefault();
      b.classList.remove('nh');
      if(!b.textContent.trim()) b.innerHTML='<br>';
      applyFolds();
      onEditorInput();
    }
  });
  /* 点大标题左边那块小箭头 → 收起 / 展开下面这一段 */
  bodyEl.addEventListener('click',e=>{
    /* 拿起状态下的投放按钮 */
    const drop=e.target.closest&&e.target.closest('.mv-drop');
    if(drop&&bodyEl.contains(drop)){
      e.preventDefault(); e.stopPropagation();
      const h=drop.parentElement, hi=headList().indexOf(h);
      if(mvState.kind==='word') mvDropWord(h||null);
      else if(mvState.kind==='section') mvDropSection(h);
      return;
    }
    const h=e.target.closest&&e.target.closest('.nh');
    if(!h||!bodyEl.contains(h)) return;
    const r=h.getBoundingClientRect();
    if(e.clientX-r.left>32) return;
    if(lpFired){ lpFired=false; return; }
    e.preventDefault();
    e.stopPropagation();
    toggleFold(h);
  });
  /* 整节长按入口已由 13_drag 的长按菜单接管；lpFired 仅保留给点击折叠判断 */
  let lpFired=false;
  editorWrap.addEventListener('mousedown',e=>{ if(e.target.closest('.en-word')) e.preventDefault(); });
  editorWrap.addEventListener('click',handleWordTap);
  document.addEventListener('selectionchange',()=>{ if(ui.mode==='edit') scheduleCheck(); });
  /* 单词卡片里的「移动」→ 拿起这个词 */
  const wmMoveBtn=$('#wmMove');
  if(wmMoveBtn) wmMoveBtn.addEventListener('click',()=>{
    const sp=mvFindSpan(wmState.term,wmState.existing&&wmState.existing.id);
    if(!sp){ toast('先在正文里打开带这个词的笔记','warn'); return; }
    mvLiftWord(sp);
  });
  const wmCopyBtn=$('#wmCopyClip');
  if(wmCopyBtn) wmCopyBtn.addEventListener('click',()=>{
    const sp=mvFindSpan(wmState.term,wmState.existing&&wmState.existing.id);
    if(!sp){ toast('先在正文里打开带这个词的笔记','warn'); return; }
    try{ closeWordModal(); }catch(_){ }
    clipCopyWord(sp,false);
  });
  const wmCutBtn=$('#wmCutClip');
  if(wmCutBtn) wmCutBtn.addEventListener('click',()=>{
    const sp=mvFindSpan(wmState.term,wmState.existing&&wmState.existing.id);
    if(!sp){ toast('先在正文里打开带这个词的笔记','warn'); return; }
    try{ closeWordModal(); }catch(_){ }
    clipCopyWord(sp,true);
  });
  $('#mvCancel').addEventListener('click',()=>{ mvReset(); toast('已取消，原样没动'); });
  $('#mvPrev').addEventListener('click',()=>mvJump(-1));
  $('#mvNext').addEventListener('click',()=>mvJump(1));
  $('#mvEnd').addEventListener('click',()=>{ if(mvState.kind==='word') mvDropWord(null); });
  $('#mvUndo').addEventListener('click',()=>{
    const fn=mvState.revert;
    mvReset();
    if(fn){ fn(); toast('已撤销'); }
  });
  /* 收起键盘：笔记用顶栏的键，其它地方用浮出的小按钮 */
  const closeKb=()=>{ closeKeyboard(); };
  btnKb.addEventListener('click',closeKb);
  kbChip.addEventListener('pointerdown',e=>{ e.preventDefault(); });
  kbChip.addEventListener('click',e=>{ e.preventDefault(); closeKb(); });
  document.addEventListener('focusin',()=>setTimeout(syncKbUI,60));
  document.addEventListener('focusout',()=>setTimeout(syncKbUI,120));
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',()=>{
      syncKbUI();
      if(pill.classList.contains('show')) placePill();
    });
  }
  $('#dictClose').addEventListener('click',closeDict);
  $('#dictGo').addEventListener('click',()=>loadDict($('#dictSearch').value));
  $('#dictSearch').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); loadDict($('#dictSearch').value); } });
  $('#dictToEmpower').addEventListener('click',()=>{
    const w=dictState.word;
    const d=dictState.data;
    closeDict();
    if(!w) return;
    const ex=state.words.find(x=>String(x.term).toLowerCase()===String(w).toLowerCase())||null;
    let prefill=null;
    if(d){
      const defs=(d.defs||[]).filter(x=>x&&x.cn);
      const definition=defs.map(x=>{
        const pos=(x.pos||'').trim();
        return (pos?pos+' ':'')+String(x.cn||'').trim();
      }).join('；');
      prefill={
        definition,
        phonetic:(d.us||d.uk||''),
        tags:(d.tags||[]).filter(Boolean).slice(0,4),
        examples:(d.examples||[]).filter(x=>x&&x.en).map(x=>({en:x.en,cn:x.cn||'',
          sense:defs.length===1?String(defs[0].cn||'').slice(0,6):''})),
        dict:{forms:(d.forms||[]).filter(f=>f&&(f.items||[]).length),phrs:(d.phrs||[]).filter(Boolean),syno:d.syno||{}}
      };
    }
    openWordModal(w,null,null,ex,prefill);
  });
  /* 例句跟读页 */
  $('#followBack').addEventListener('click',closeFollow);
  $('#followPlay').addEventListener('click',playFollow);
  $('#followMic').addEventListener('click',toggleFollowRec);
  $('#followOut').addEventListener('click',()=>playFollowRec());
  $('#followCmp').addEventListener('click',compareFollow);

  /* 复习键盘：空格翻卡，1/2/3 评分，自由模式用左右箭头 */
  document.addEventListener('keydown',e=>{
    if(ui.mode!=='flash') return;
    if(e.target&&/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if(document.querySelector('.modal.show')||$('#aiModal').classList.contains('show')) return;
    const f=ui.flash;
    const dueMode=f&&f.mode!=='free';
    if(dueMode&&f&&f.flipped&&['1','2','3'].includes(e.key)){
      e.preventDefault(); gradeCurrent(Number(e.key)-1); return;
    }
    if(e.key===' '||e.key==='Enter'){ e.preventDefault(); flipFlash(); }
    else if(e.key==='ArrowRight'){ e.preventDefault(); stepFlash(1); }
    else if(e.key==='ArrowLeft'){ e.preventDefault(); stepFlash(-1); }
  });

  /* 单词弹窗 */
  $('#wmClose').addEventListener('click',closeWordModal);
  $('#wmSpeak').addEventListener('click',()=>{ if(wmState.term) speakWord(wmState.term); });
  $('#wmFollow').addEventListener('click',()=>{
    const t=wmState&&wmState.term;
    if(!t){ toast('还没有单词','warn'); return; }
    openFollow(t,t,'');
  });
  /* 快查小卡 */
  $('#qdClose').addEventListener('click',closeQuickDict);
  $('#qdMask').addEventListener('click',closeQuickDict);
  $('#qdSpeak').addEventListener('click',()=>{ if(qdState.show) speakWord(qdState.show); });
  $('#qdMark').addEventListener('click',()=>{
    const c=qdMarkCtx();
    if(!c){ toast('只能在例句里标亮：先点一下句子里的词','warn'); return; }
    if(!firstGuideCanMark(c))return;
    const on=qmToggleAt(c.wkey,c.exi,c.snap,c.from,c.to,c.label);
    if(on)firstShotMarked();
    try{ repaintEx(c.exi); }catch(_){ }
    qdState.sel=null;
    try{ qdSelClear(); syncQdPhraseBar(); syncQdMark(); }catch(_){ }
    try{ if(on&&navigator.vibrate) navigator.vibrate(12); }catch(_){ }
    toast(on?(c.phrase?'已标亮这句里的这一小段':'已标亮这句里的这个词'):'已取消标亮', on?'ok':'');
    /* 标亮后收起卡片，让你直接看到黄底效果 */
    if(on) setTimeout(()=>{ try{ closeQuickDict(); }catch(_){ } }, 260);
  });
  $('#qdPhNext').addEventListener('click',()=>{ qdExtend(1); });
  $('#qdPhBack').addEventListener('click',()=>{ qdExtend(-1); });
  $('#qdFull').addEventListener('click',()=>{
    const w=qdState.show;
    closeQuickDict();
    if(w) openDict(w);
  });
  /* 快查里直接存词：绝不切换/覆盖正在编辑的单词卡片 */
  $('#qdSave').addEventListener('click',()=>{
    const w=String(qdState.show||'').trim();
    if(!w) return;
    const key=w.toLowerCase();
    const exist=(state.words||[]).find(x=>String(x.term||'').toLowerCase()===key);
    if(exist){ closeQuickDict(); toast('「'+exist.term+'」已经在表达库里了'); return; }
    const def=String(qdState.data&&(qdState.data.mine||qdState.data.cn)||'').trim()
      ||String((qdState.data&&qdState.data.en&&qdState.data.en[0])||'').trim();
    upsertWord({term:w,definition:def,examples:[],tags:[],source:'manual',notes:[]});
    save();
    closeQuickDict();
    toast(def?'已加入表达库：'+w:'已加入表达库：'+w+'（还没释义，可在表达库里补）','ok');
  });
  $('#wmAi').addEventListener('click',openAiDialogue);
  /* 三 tab：例句 / 核心搭配 / 标签 */
  $('#wmTabs').addEventListener('click',e=>{
    const tab=e.target.closest('.wm-tab');
    if(!tab) return;
    setWordModalTab(tab.dataset.wmtab);
    firstGuideTabClicked(tab.dataset.wmtab);
  });
  $('#aiClose').addEventListener('click',closeAiModal);
  $('#aiClose2').addEventListener('click',aiFinishAction);
  $('#aiFavorite').addEventListener('click',aiFavoriteCurrent);
  $('#aiFavoritesClose').addEventListener('click',()=>$('#aiFavoritesModal').classList.remove('show'));
  $('#aiFavoritesModal').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.classList.remove('show');});
  $('#aiAgain').addEventListener('click',aiAgainAction);
  $('#aiSend').addEventListener('click',submitAttempt);
  $('#aiInput').addEventListener('keydown',e=>{ if(e.key==='Enter') submitAttempt(); });
  $('#aiMic').addEventListener('click',aiMicDictate);
  $('#aiModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeAiModal(); });
  $('#aiScene').addEventListener('click',e=>{
    const sc=e.target.closest('[data-scene]');
    if(sc){ startScene(aiState.scenes[parseInt(sc.getAttribute('data-scene'),10)]); return; }
    const gs=e.target.closest('#aiGotoScenes');
    if(gs){ aiGotoScenes(); return; }
  });
  $('#wordModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeWordModal(); });
  $('#settingsModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) $('#settingsModal').classList.remove('show'); });
  $('#wmSave').addEventListener('click',saveWord);
  $('#wmRegen').addEventListener('click',()=>wmGenExamples());
  $('#wmDefinition').addEventListener('input',()=>scheduleWmDraft(700));
  $('#wmDraftDrop').addEventListener('click',()=>{
    if(!wmState) return;
    const term=wmState.term, note=wmState.note, range=wmState.range, existing=wmState.existing;
    wmDraftDel(term);
    wmState.saved=true;
    openWordModal(term,note,range,existing);
    toast('已丢弃这份草稿','ok');
  });
  $('#wmExamples').addEventListener('click',e=>{
    const qw=e.target.closest('.qw');
    if(qw){
      e.stopPropagation();
      const row=qw.closest('[data-excn]');
      const exi=row?Number(row.getAttribute('data-excn')):-1;
      const wi=Number(qw.getAttribute('data-i'));
      openQuickDict(qw.dataset.q||qw.textContent,(exi>=0&&qw.hasAttribute('data-i')&&!isNaN(wi))?{exi,wi}:null);
      return;
    }
    const enRow=e.target.closest('[data-excn]');
    if(enRow){ toggleExCnRow(enRow); return; }
    const sp=e.target.closest('[data-wmplay]');
    if(sp){
      const x=(wmState.examples||[])[Number(sp.dataset.wmplay)];
      if(x&&x.en) speak(x.en,'en-US');
      return;
    }
    const fo=e.target.closest('[data-follow]');
    if(fo){
      const x=(wmState.examples||[])[Number(fo.dataset.follow)];
      if(x&&x.en) openFollow(x.en,wmState.term,x.cn||''); else toast('这句还没有内容','warn');
      return;
    }
  });
  $('#wmTags').addEventListener('click',e=>{
    const chip=e.target.closest('[data-tag]');
    if(!chip) return;
    toggleWmTag(chip.dataset.tag);
  });

  /* 核心搭配：添加 / 删除 */
  $('#wmCollAdd').addEventListener('click',addWmColl);
  $('#wmCollInput').addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault(); addWmColl(); }
  });
  $('#wmColls').addEventListener('click',e=>{
    const chip=e.target.closest('[data-coll]');
    if(!chip) return;
    removeWmColl(Number(chip.dataset.coll));
  });

  /* 截图：全局悬浮导入 / 释义区查看按钮 / 大图查看器（点任意处返回） */
  $('#ocrFileInput').addEventListener('change',ocrImportImage);
  $('#ocrInboxOpen').addEventListener('click',ocrInboxToggle);
  $('#ocrChooseFile').addEventListener('click',()=>$('#ocrFileInput').click());
  $('#shotViewer').addEventListener('click',e=>{
    if(e.target.closest('#svPrev')||e.target.closest('#svNext')||e.target.closest('#svDel')) return;
    closeShotViewer();
  });
  $('#svPrev').addEventListener('click',e=>{ e.stopPropagation(); viewerStep(-1); });
  $('#svNext').addEventListener('click',e=>{ e.stopPropagation(); viewerStep(1); });
  $('#svDel').addEventListener('click',e=>{ e.stopPropagation(); viewerDel(); });
  $('#ocrSheet').addEventListener('click',e=>{
    if(e.target.closest('[data-ocr-close]')||e.target.id==='ocrSheet'){
      ocrCloseSheet();
      return;
    }
    const area=e.target.closest('[data-ocr-area]');
    if(!area)return;
    const chip=e.target.closest('[data-cand]');
    if(chip){ocrToggleMatch(chip,area);return;}
    if(e.target.closest('[data-inbox-confirm]'))ocrInboxConfirm(area);
    if(e.target.closest('[data-inbox-delete]'))ocrInboxDelete(area);
  });
  $('#ocrSheet').addEventListener('input',e=>{
    if(!e.target.matches('[data-ocr-text],[data-ocr-term]'))return;
    ocrRenderMatchArea(e.target.closest('[data-ocr-area]'));
  });
  $('#ocrBatchList').addEventListener('change',async e=>{
    if(e.target.matches('[data-inbox-pick]')){ocrSyncBatchMatch();return;}
    if(!e.target.matches('[data-ocr-text]'))return;
    const row=e.target.closest('[data-inbox-id]');
    try{await ocrRememberInboxText(row,e.target.value);}
    catch(_){toast('识别文字未保存，原图仍保留','warn');}
  });
  $('#ocrMount').addEventListener('click',ocrMount);
  $('#ocrBatchConfirm').addEventListener('click',ocrBatchConfirm);


  /* 写作练习 */
  $('#writeClose').addEventListener('click',closeWriteModal);
  $('#writeModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeWriteModal(); });
  $('#writeBack').addEventListener('click',()=>{
    if(writeState.step==='review'){ writeState.step='topic'; writeRender(); }
    else if(writeState.step==='topic'){ writeState.step='pick'; writeRender(); }
  });
  $('#writeNext').addEventListener('click',()=>{
    if(writeState.step==='pick'){ writeGenAndShow(); }
    else if(writeState.step==='topic'){ writeSubmit(); }
    else if(writeState.step==='review'){ writeSaveNote(); }
  });
  $('#writeContent').addEventListener('keydown',e=>{
    if(e.target&&e.target.id==='writeArea'&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){ e.preventDefault(); writeSubmit(); }
  });

  /* 确认弹窗 */
  $('#cfOk').addEventListener('click',()=>{
    const cb=confirmCb; closeConfirm();
    if(cb) cb();
  });
  $('#cfCancel').addEventListener('click',closeConfirm);
}

function jumpToNote(noteId){
  const n=state.notes.find(x=>x.id===noteId);
  if(!n){ toast('这篇笔记已被删除','warn'); return; }
  ui.folder=n.folderId; ui.note=n.id; ui.mode='edit'; ui.tag=null; ui.sideOpen=false;
  render();
}

/* ============ 今日工作台 ============ */
function dayStart(ts){ const d=new Date(ts||Date.now()); d.setHours(0,0,0,0); return d.getTime(); }
function isToday(ts){ const s=dayStart(Date.now()); return !!(ts&&ts>=s&&ts<s+DAY); }
function todayNewWords(){ return state.words.filter(w=>isToday(w.createdAt)); }
function weakSpeakLogs(){ return (state.aiLog||[]).filter(x=>x.score<80||(Array.isArray(x.pitfalls)&&x.pitfalls.length)); }
function weakSpeakLogsToday(){ return (state.aiLog||[]).filter(x=>(x.score<80||(Array.isArray(x.pitfalls)&&x.pitfalls.length))&&isToday(x.createdAt)); }
function todayCard(go,title,desc,num){
  return '<div class="today-card" data-go="'+go+'">'+
    '<div class="tc-num">'+num+'</div>'+
    '<div class="tc-main"><div class="tc-title">'+title+'</div><div class="tc-desc">'+desc+'</div></div>'+
    '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text3)"><path d="M9 6l6 6-6 6"/></svg>'+
  '</div>';
}
function renderToday(){
  $('#paneTitle').textContent='今日';
  $('#btnNewNote').style.display='inline-flex';
  const box=$('#noteList');
  const due=dueCount();
  const fresh=todayNewWords().length;
  const weak=weakSpeakLogsToday().length;
  const writeCnt=writeLogCountToday();
  const packN=packableWords().length;
  box.innerHTML=
    '<div class="rv-stats">'+
      '<div class="rv-stat hot"><div class="n">'+due+'</div><div class="l">今日到期</div></div>'+
      '<div class="rv-stat"><div class="n">'+fresh+'</div><div class="l">今日新词</div></div>'+
      '<div class="rv-stat'+(weak?' hot':'')+'"><div class="n">'+weak+'</div><div class="l">口语待加强</div></div>'+
    '</div>'+
    '<div class="today-greet">每天 45 分钟：先复习，再开口，最后写一段。</div>'+
    '<div class="today-actions">'+
      todayCard('flash','闪卡复习','把到期的词过一遍',due)+
      todayCard('pack','打包口语','难词一次练 '+packN+' 个',packN)+
      todayCard('write','写作练习','今日已写 '+writeCnt+' 篇 · 用今天的词写一段',writeCnt)+
      todayCard('words','今日新词','回看今天攒的生词',fresh)+
    '</div>'+
    '<div class="today-tip">输入 25′（视频+跟读）→ 加工 10′（搭配+标签）→ 复习 10′（闪卡）。每周 2 次口语打包、1 次写作。</div>';
  $$('#noteList [data-go]').forEach(el=>el.addEventListener('click',()=>{
    const g=el.dataset.go;
    if(g==='flash'){ ui.mode='flash'; ui.flash=null; render(); }
    else if(g==='words'){ ui.mode='words'; ui.wordFilter='today'; ui.selMode=false; ui.sel=[]; render(); }
    else if(g==='speak'){ ui.mode='speak'; render(); }
    else if(g==='write'){ openWriteModal(); }
    else if(g==='pack'){ openAiPackPractice(packableWords()); }
  }));
}
function packableWords(){
  let arr=(state.words||[]).filter(w=>!w.mastered&&isDue(w)&&((w.srs&&w.srs.box)||1)<=2);
  if(arr.length<2){ arr=(state.words||[]).filter(w=>!w.mastered&&isDue(w)); }
  if(arr.length<2){ arr=todayNewWords(); }
  if(arr.length<2){ arr=(state.words||[]).filter(w=>!w.mastered); }
  return arr.slice(0,5);
}
/* 多词打包口语：一次对话练 2-5 个词 */
function openAiPackPractice(terms){
  const list=(terms&&terms.length)?terms:(packableWords());
  if(!list.length){ toast('还没有可以打包练习的词，先去攒几个','warn'); return; }
  aiState={seq:0,phase:'scenes',terms:list.map(w=>w.term),termIds:list.map(w=>w.id),allTerms:list.map(w=>w.term),allTermIds:list.map(w=>w.id),multiTurn:list.length>1,sceneIndex:-1,scenePlanFallback:false,turnIndex:0,currentTargetWord:'',turnResults:[],
    term:list.map(w=>w.term).join(' · '),
    definition:list.map(w=>(w.definition||'').split('\n')[0]).filter(Boolean).join('；'),
    examples:list.slice(0,4).reduce((a,w)=>a.concat((w.examples||[]).map(x=>x.en)),[]),
    scenes:[],scene:null,lines:[],attempt:'',attemptPromptCn:'',busy:false};
  if(typeof aiDialogueHistoryStart==='function') aiDialogueHistoryStart(list);
  $('#aiTitle').textContent='情景口语 · '+list.length+' 词';
  $('#aiSub').textContent='一次对话，尽量用上这些词';
  $('#aiScoreChip').classList.add('hidden');
  const favorite=$('#aiFavorite');if(favorite){favorite.textContent='收藏对话';favorite.disabled=true;}
  $('#aiScene').innerHTML='';
  $('#aiModal').classList.add('show');
  /* 旧对话复练：同一组词默认打开上次练过的场景，答案清空，保留「重新生成」 */
  if(typeof aiFindRecentSession==='function'&&typeof aiRestoreLastScene==='function'){
    const hist=aiFindRecentSession(list.map(w=>w.id));
    if(hist&&hist.exact&&aiRestoreLastScene(hist.session)){
      if(typeof aiDialogueHistoryScene==='function') aiDialogueHistoryScene(aiState.scene,aiState.lines,aiState.termIds||[]);
      aiShowBody(); aiSetChatbar('practice'); aiRenderDialogue(); aiSyncContext('practice');
      toast('已还原上次练的场景，答案已清空；点「换一批情景」重新生成','ok');
      return;
    }
  }
  const mySeq=++aiState.seq;
  aiShowLoading('正在挑场景…');
  if(!aAiReady()){
    aiShowBody(); aiSetChatbar('scenes');
    $('#aiScene').innerHTML=aiGuideHtml('未配置模型 API，请先在设置中填写');
    const r=$('#aiRetry'); if(r) r.addEventListener('click',()=>openAiPackPractice(list));
    const g=$('#aiGotoSettings'); if(g) g.addEventListener('click',()=>{ closeAiModal(); openSettings(); });
    return;
  }
  aiSuggestScenes().then(r=>{
    if(mySeq!==aiState.seq) return;
    const sourceIds=new Set(aiState.allTermIds||aiState.termIds||[]);
    const sc=(r.scenes||[]).filter(x=>x&&x.title&&(!aiState.multiTurn||(Array.isArray(x.wordIds)&&x.wordIds.some(id=>sourceIds.has(id))))).slice(0,3);
    if(!sc.length) throw new Error('返回内容无法解析，请重试');
    aiState.scenes=sc; aiState.phase='scenes'; aiState.scenePlanFallback=false;
    aiShowBody(); aiSetChatbar('scenes'); aiRenderScenes();
  }).catch(err=>{
    if(mySeq!==aiState.seq) return;
    if(aiState.multiTurn){
      aiState.scenes=aiFallbackSceneGroups();
      aiState.phase='scenes'; aiState.scenePlanFallback=true;
      aiShowBody(); aiSetChatbar('scenes'); aiRenderScenes();
      toast(/abort|超时/i.test(String(err&&err.message||''))?'AI 场景请求超时，已显示快速分组':'AI 场景请求失败，已显示快速分组','warn');
      return;
    }
    aiShowBody();
    $('#aiScene').innerHTML='<div class="empty-state">'+esc(String(err&&err.message||'生成失败，请重试'))+'</div>';
    const r=$('#aiRetry'); if(r) r.addEventListener('click',()=>openAiPackPractice(list));
  });
}
