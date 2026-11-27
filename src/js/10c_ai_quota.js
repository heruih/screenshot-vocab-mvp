/* A evolution: supplemental data is keyed by stable word ID; legacy content
 * stays in its original keys. Import never overwrites an existing word ID. */
const A_KEY='english-notes-learning-a-v1';
const A_PREF_KEY='english-notes-ai-route-a-v1';
const A_TASK_KEY='english-notes-chatgpt-task-a-v1';
const AI_PROVIDERS_KEY='en-ai-providers-v1';
const AI_IMAGE_KEY='en-ai-image-v1';
const AI_PROVIDER_DEFAULTS={
  deepseek:{label:'DeepSeek',baseUrl:'https://api.deepseek.com',apiKey:'',model:'deepseek-flash'},
  openai:{label:'OpenAI GPT',baseUrl:'https://api.openai.com/v1',apiKey:'',model:'gpt-4o-mini'}
};
let aData={words:{},attempts:[]};
let aBridgeJob=null;
let aRecallState=null;
function aStore(key,value){
  try{localStorage.setItem(key,value);return true;}
  catch(e){toast('没有保存成功：浏览器空间不足或存储被禁用。请先下载完整备份。','warn');return false;}
}
/* ============ 配额治理：容量统计、预检、占用显示 ============ */
/* 按最保守的移动端限制估算：iPhone Safari 单 origin 约 5MB。
   桌面 Chrome 实际约 10MB，用 5MB 估算只会更保守，不会让用户存爆。 */
const LS_QUOTA=5*1024*1024;
const LS_WARN_RATIO=0.8;
const _utf8=new TextEncoder();
function byteLen(s){return _utf8.encode(String(s==null?'':s)).length;}
function fmtBytes(n){
  if(n<1024)return n+' B';
  if(n<1024*1024)return (n/1024).toFixed(1)+' KB';
  return (n/1024/1024).toFixed(2)+' MB';
}
/* 同步统计 localStorage 全部已用字节（key 名 + 值，按 UTF-8 精确计算） */
function storageUsedBytes(){
  let bytes=0;
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    bytes+=byteLen(k)+byteLen(localStorage.getItem(k));
  }
  return bytes;
}
/* IndexedDB 截图库占用：用内存数据估算（http 下 navigator.storage 不可用） */
function idbUsedBytes(){
  let b=0;
  if(shotReady&&shotCache) b+=byteLen(JSON.stringify(shotCache));
  if(inboxReady&&inboxCache) b+=byteLen(JSON.stringify(inboxCache));
  return b;
}
/* 逐个 key 统计占用，返回 [{key,bytes}] 从大到小 */
function storageBreakdown(){
  const out=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    out.push({key:k,bytes:byteLen(k)+byteLen(localStorage.getItem(k))});
  }
  return out.sort((a,b)=>b.bytes-a.bytes);
}
/* 当前配额快照（仅 localStorage 的保守口径，拿不到 estimate 时兜底用） */
function storageQuote(){
  const used=storageUsedBytes();
  return {used,quota:LS_QUOTA,free:Math.max(0,LS_QUOTA-used),ratio:used/LS_QUOTA};
}
/* 总存储视角：navigator.storage.estimate 覆盖 localStorage + IndexedDB + Cache 的真实占用与配额 */
let _estCache=null,_estPending=false;
async function storageEstimate(){
  try{
    if(navigator.storage&&typeof navigator.storage.estimate==='function'){
      const est=await navigator.storage.estimate();
      if(est&&est.quota){
        _estCache={usage:est.usage||0,quota:est.quota||0};
        return _estCache;
      }
    }
  }catch(_){}
  _estCache=null;
  return null;
}
/* 把内部 key 名翻译成大白话标签，不认识的保留原名 */
function storageKeyLabel(k){
  const map={
    'english-notes-app-v1':'词条 / 笔记 / 设置主数据',
    'english-notes-shots-v1':'单词关联截图',
    'en-shot-inbox-v1':'截图批量收件箱',
    'english-notes-wmimg-v1':'单词 AI 配图缓存',
    'english-notes-qmarks-v2':'例句标亮',
    'english-notes-learning-a-v1':'学习记录',
    'english-notes-ai-route-a-v1':'AI 路由偏好',
    'english-notes-dialogue-batch-v1':'批量情景对话',
    'english-notes-dialogue-preferences-v1':'对话偏好',
    'english-notes-dialogue-history-v1':'对话历史'
  };
  return map[k]||k;
}
/* 渲染设置弹窗里的存储占用：先同步画，再异步刷新真实总存储 */
function storageRender(){
  storageRenderStatic();
  storageRefreshAsync();
}
/* 纯同步：进度条 + 文案 + 预警 + 明细（用当前缓存的 estimate，没有就退回 LS 口径） */
function storageRenderStatic(){
  const fill=$('#stStoreFill'),text=$('#stStoreText'),warn=$('#stStoreWarn'),br=$('#stStoreBreak');
  if(!fill)return;
  let used,quota;
  if(_estCache){used=_estCache.usage;quota=_estCache.quota;}
  else{const q=storageQuote();used=q.used;quota=q.quota;}
  const free=Math.max(0,quota-used),ratio=quota?used/quota:0;
  const pct=Math.min(100,Math.round(ratio*100));
  fill.style.width=pct+'%';
  fill.classList.toggle('hot',ratio>=LS_WARN_RATIO);
  text.textContent='已用 '+fmtBytes(used)+' / 约 '+fmtBytes(quota)+'（'+pct+'%）· 剩余 '+fmtBytes(free);
  if(ratio>=LS_WARN_RATIO){
    warn.hidden=false;
    warn.textContent='占用已超过 80%，建议先导出完整备份，再清理不需要的截图或配图缓存。';
  }else{warn.hidden=true;}
  const rows=storageBreakdown().slice(0,6);
  br.innerHTML=rows.map(r=>'<div class="sb-row"><span class="sb-label">'+esc(storageKeyLabel(r.key))+'</span><span class="sb-bytes">'+fmtBytes(r.bytes)+'</span></div>').join('');
  renderIdbRow(_imgBlobCache);
}
/* 截图库行（同步）+ 已固定配图行（字节拿到后才显示） */
let _imgBlobCache=null;
function renderIdbRow(imgBytes){
  const idbEl=$('#stStoreIdb');
  if(!idbEl)return;
  const idbOn=shotUseIdb||inboxUseIdb;
  const shotsN=(shotReady?shotsTotal(shotCache):0)+(inboxReady&&inboxCache?inboxCache.length:0);
  let h=idbOn
    ?'<div class="sb-row"><span class="sb-label">截图库（大容量）· '+shotsN+' 张（含收件箱）</span><span class="sb-bytes">'+fmtBytes(idbUsedBytes())+'</span></div>'
    :'<div class="sb-row"><span class="sb-label">截图库未启用，仍占本地存储</span><span class="sb-bytes">'+fmtBytes(idbUsedBytes())+'</span></div>';
  if(typeof imgBytes==='number'){
    h+='<div class="sb-row"><span class="sb-label">单词配图（已固定到本机）</span><span class="sb-bytes">'+fmtBytes(imgBytes)+'</span></div>';
  }
  idbEl.innerHTML=h;
}
/* 异步拿真实总存储和配图字节，设置面板仍开着就重画，不递归触发新请求 */
function storageRefreshAsync(){
  if(_estPending)return;
  _estPending=true;
  (async()=>{
    try{
      await storageEstimate();
      try{_imgBlobCache=await imgBlobBytes();}catch(_){}
      const modal=$('#settingsModal');
      if(modal&&modal.classList.contains('show'))storageRenderStatic();
    }finally{_estPending=false;}
  })();
}
function aRead(key,fallback){try{return JSON.parse(localStorage.getItem(key))||fallback;}catch(_){return fallback;}}
function aFlush(){if(!aStore(A_KEY,JSON.stringify(aData)))throw new Error('学习信息没有保存成功');}
function aMeta(w){return aData.words[w.id]||{};}
function aPending(w){return aMeta(w).stage==='pending';}
function aPut(id,patch){const old=aData.words[id];aData.words[id]=Object.assign({},old||{},patch,{updatedAt:Date.now()});try{aFlush();}catch(e){if(old)aData.words[id]=old;else delete aData.words[id];throw e;}}
function aDate(t){const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function aiProviderState(){
  let raw={};
  try{raw=JSON.parse(localStorage.getItem(AI_PROVIDERS_KEY)||'{}')||{};}catch(_){ }
  const providers={};
  Object.keys(AI_PROVIDER_DEFAULTS).forEach(name=>{
    const legacy=name==='openai'&&state&&state.settings?{baseUrl:state.settings.baseUrl||'',apiKey:state.settings.apiKey||'',model:state.settings.model||''}:{};
    providers[name]=Object.assign({},AI_PROVIDER_DEFAULTS[name],legacy,raw.providers&&raw.providers[name]||{});
  });
  return {selected:raw.selected==='openai'?'openai':'deepseek',providers};
}
function aiProviderCfg(){const p=aiProviderState();return Object.assign({name:p.selected},p.providers[p.selected]);}
function aiProviderSave(patch){
  const p=aiProviderState(),name=patch&&patch.name==='openai'?'openai':(patch&&patch.name)||p.selected;
  if(patch&&patch.name)delete patch.name;
  p.selected=name;p.providers[name]=Object.assign({},p.providers[name],patch||{});
  try{localStorage.setItem(AI_PROVIDERS_KEY,JSON.stringify(p));}catch(_){ }
  return p;
}
function aiProviderSaveFields(){
  const name=$('#aProvider')&&$('#aProvider').value==='openai'?'openai':'deepseek';
  aiProviderSave({name,baseUrl:$('#stBase').value.trim(),apiKey:$('#stKey').value.trim(),model:$('#stModel').value.trim()});
}
function aiProviderRefreshFields(){
  const p=aiProviderState(),name=p.selected,cfg=p.providers[name];
  const select=$('#aProvider');if(select)select.value=name;
  ['stBase','stKey','stModel'].forEach(id=>{const el=$('#'+id);if(el&&document.activeElement!==el)el.value=cfg[id==='stBase'?'baseUrl':id==='stKey'?'apiKey':'model']||'';});
  const base=$('#stBase');if(base)base.placeholder=cfg.baseUrl;
  const model=$('#stModel');if(model)model.placeholder=cfg.model;
}
function aRoute(){return localStorage.getItem(A_PREF_KEY)==='chatgpt'?'chatgpt':'api';}
function aiApiConfig(){return aiProviderCfg();}
function aAiReady(){
  if(aRoute()==='chatgpt') return true;
  const cfg=aiProviderCfg();
  if(cfg.apiKey) return Boolean(cfg.model&&cfg.baseUrl);
  return globalThis.APP_CONFIG?.product==='commercial'&&Boolean(textRelayConfig().relayUrl);
}
function aiImageConfig(){
  const saved=aRead(AI_IMAGE_KEY,{}),provider=aiProviderCfg(),useProvider=provider.name==='openai';
  return {baseUrl:String(saved.baseUrl||(useProvider?provider.baseUrl:'')).trim(),apiKey:String(saved.apiKey||(useProvider?provider.apiKey:'')).trim(),model:String(saved.model||'gpt-image-1').trim()};
}
function aiImageSaveFields(){
  aStore(AI_IMAGE_KEY,JSON.stringify({baseUrl:$('#stImageBase').value.trim(),apiKey:$('#stImageKey').value.trim(),model:$('#stImageModel').value.trim()||'gpt-image-1'}));
}
function aiImageRefreshFields(){
  const cfg=aiImageConfig(),base=$('#stImageBase'),key=$('#stImageKey'),model=$('#stImageModel');
  if(base&&document.activeElement!==base)base.value=cfg.baseUrl;
  if(key&&document.activeElement!==key)key.value=cfg.apiKey;
  if(model&&document.activeElement!==model)model.value=cfg.model;
}
function aImageCacheStats(all,words){
  const cache=all&&typeof all==='object'?all:{};
  const list=Array.isArray(words)?words:[];
  let cachedWords=0,confirmedWords=0;
  const missingTerms=[];
  list.forEach(w=>{
    const rec=cache[wmImgKeyOf(w&&w.term)],has=!!(rec&&(rec.local||(Array.isArray(rec.cands)&&rec.cands.length)||(rec.memo&&rec.memo.scene)));
    if(has){cachedWords++;if(rec.confirmed)confirmedWords++;}else if(w&&w.term)missingTerms.push(String(w.term));
  });
  return {records:Object.keys(cache).length,cachedWords,confirmedWords,missingWords:missingTerms.length,missingTerms:missingTerms.slice(0,20)};
}
function aImageStatsFromStorage(storage){
  let words=[],all={};
  try{const main=JSON.parse(storage&&storage[LS_KEY]||'{}');words=main.words||[];}catch(_){ }
  try{all=JSON.parse(storage&&storage[WM_IMG_KEY]||'{}')||{};}catch(_){ }
  return aImageCacheStats(all,words);
}
/* 登录凭证（含会话 token、邮箱）永不进备份，导出时一律剔除 */
const SENSITIVE_BACKUP_KEYS=['english-notes-account-v1'];
function aBackupKeys(){const out={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('english-notes-')&&k!==CLIPBOARD_KEY&&!SENSITIVE_BACKUP_KEYS.includes(k))out[k]=localStorage.getItem(k);}return out;}
/* 落地配图备份 key：存 {单词小写: dataURL}，独立 key，不与旧缓存冲突 */
const WM_IMG_BLOB_KEY='english-notes-wmimg-blob-v1';
/* 把 images store 的 Blob 全部转 dataURL，组装成备份对象 */
async function imgBlobToBackup(){
  const out={};
  let keys=[];
  try{ keys=await imgBlobAllKeys(); }catch(_){ return out; }
  for(const k of keys){
    let b=null;
    try{ b=await idbGet(IDB_STORE_IMAGES,k); }catch(_){}
    if(!b)continue;
    const durl=await new Promise(res=>{
      const fr=new FileReader();
      fr.onload=()=>res(fr.result);
      fr.onerror=()=>res(null);
      fr.readAsDataURL(b);
    });
    if(durl)out[k]=durl;
  }
  return out;
}
async function aBackupObject(){
  const image=aImageCacheStats(wmImgAll(),state.words);
  const storage=aBackupKeys();
  /* 截图/收件箱已迁到 IDB，导出时用内存里的最新数据覆盖，避免漏掉新图 */
  if(shotReady) storage[SHOTS_KEY]=JSON.stringify(shotCache);
  if(inboxReady) storage[SHOT_INBOX_KEY]=JSON.stringify(inboxCache);
  /* 落地配图：Blob 转 dataURL 纳入备份，保证换设备不丢 */
  try{ const blobPack=await imgBlobToBackup(); if(Object.keys(blobPack).length)storage[WM_IMG_BLOB_KEY]=JSON.stringify(blobPack); }catch(_){}
  return {format:'english-notes-full',version:2,exportedAt:new Date().toISOString(),origin:location.origin,counts:{words:state.words.length,notes:state.notes.length,shots:shotsTotal(shotsAll()),writing:writeLogAll().length,imageCache:image.records,imageCacheWords:image.cachedWords,imageCacheConfirmed:image.confirmedWords,imageCacheMissing:image.missingWords},storage:storage};
}
async function aDownloadBackup(){
  try{if(ui.mode==='edit')persistEditor();if(wmState&&!wmState.saved)wmDraftSave();writeDraftSave();const pack=await aBackupObject();const blob=new Blob([JSON.stringify(pack,null,2)],{type:'application/json'});const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download='英语学习完整备份-'+aDate(Date.now())+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);$('#aBackupStatus').textContent='已请求下载：'+pack.counts.words+' 个表达、'+pack.counts.shots+' 张截图、'+pack.counts.writing+' 篇写作。请在下载列表确认文件已保存。';}
  catch(e){toast('备份失败：'+e.message,'warn');}
}
function aMergeArray(local,remote,kind){
  const result=local.slice(),ids=new Set(local.map(x=>x.id).filter(Boolean));
  const terms=new Set(kind==='words'?local.map(x=>String(x.term||'').trim().toLowerCase()):[]);
  remote.forEach(x=>{if(!x||typeof x!=='object'||!x.id||ids.has(x.id))return;const term=String(x.term||'').trim().toLowerCase();if(kind==='words'&&terms.has(term))return;result.push(x);ids.add(x.id);if(kind==='words')terms.add(term);});return result;
}
function aMergeState(local,remote){
  if(!remote||!Array.isArray(remote.words)||!Array.isArray(remote.notes))throw new Error('备份缺少表达或笔记');
  if(remote.words.some(w=>!w||typeof w.id!=='string'||typeof w.term!=='string'))throw new Error('表达格式不完整');
  const out=Object.assign({},remote,local);
  ['words','notes','folders','aiLog','grave'].forEach(k=>out[k]=aMergeArray(local[k]||[],remote[k]||[],k));
  if(!(local.words||[]).length&&!(local.notes||[]).length){if(!(local.settings&&local.settings.apiKey)&&remote.settings)out.settings=remote.settings;if(remote.meta)out.meta=remote.meta;}
  out.tagList=[...new Set([...(local.tagList||[]),...(remote.tagList||[])])];return out;
}
/* 标亮记录没有 id，不能走"按 id 去重"的通用路径；按它的自然键（词条+例句序号+原文+起止词）合并 */
function qmMerge(localRaw,remoteRaw){
  let l,r;
  try{l=JSON.parse(localRaw);r=JSON.parse(remoteRaw);}catch(_){return localRaw;}
  if(!Array.isArray(l)||!Array.isArray(r))return localRaw;
  const keyOf=x=>[x.w,x.e,x.s,x.f,x.t].map(v=>String(v)).join('');
  const seen=new Set(l.map(keyOf));
  r.forEach(x=>{if(!x||typeof x!=='object')return;const k=keyOf(x);if(!seen.has(k)){l.push(x);seen.add(k);}});
  return JSON.stringify(l);
}
function aMergeExtra(key,localRaw,remoteRaw){
  if(localRaw===null)return remoteRaw;
  if(key===A_PREF_KEY)return localRaw;
  if(key===QM_KEY)return qmMerge(localRaw,remoteRaw);
  let l,r;try{l=JSON.parse(localRaw);r=JSON.parse(remoteRaw);}catch(_){return localRaw;}
  if(key===A_KEY){return JSON.stringify({words:Object.assign({},r.words||{},l.words||{}),attempts:aMergeArray(l.attempts||[],r.attempts||[])});}
  if(key===WM_IMG_KEY){
    const out=Object.assign({},l||{});
    Object.keys(r||{}).forEach(k=>{
      const local=l&&l[k],remote=r&&r[k];
      const remoteHasCandidates=remote&&Array.isArray(remote.cands)&&remote.cands.length;
      const remoteConfirmed=!!(remote&&remote.confirmed),localConfirmed=!!(local&&local.confirmed);
      const remoteIsPixabay=remote&&remote.prov==='pixabay',localIsOther=local&&local.prov&&local.prov!=='pixabay';
      if(!local||((!Array.isArray(local.cands)||!local.cands.length)&&remoteHasCandidates)||(remoteConfirmed&&!localConfirmed)||(remoteIsPixabay&&localIsOther&&!localConfirmed)||(remote&&local&&(remote.at||0)>(local.at||0)))out[k]=remote;
    });
    return JSON.stringify(out);
  }
  if(key===SHOTS_KEY){const out=Object.assign({},l);Object.keys(r||{}).forEach(k=>{if(!Array.isArray(r[k]))return;out[k]=aMergeArray(Array.isArray(l[k])?l[k]:[],r[k]);});return JSON.stringify(out);}
  if(Array.isArray(l)&&Array.isArray(r))return JSON.stringify(aMergeArray(l,r));
  if(l&&r&&typeof l==='object'&&typeof r==='object'&&!Array.isArray(l)&&!Array.isArray(r))return JSON.stringify(Object.assign({},r,l));
  return localRaw;
}
function aPrepareImport(pack){
  let storage;
  if(pack&&pack.format==='english-notes-full'&&pack.storage&&typeof pack.storage==='object')storage=pack.storage;
  else if(pack&&Array.isArray(pack.words))storage={[LS_KEY]:JSON.stringify(pack)};
  else throw new Error('不是本应用的备份');
  if(typeof storage[LS_KEY]!=='string')throw new Error('备份缺少主数据');
  const existing=localStorage.getItem(LS_KEY);
  // An empty new origin must not keep demo data or replace the imported settings.
  const base=existing?JSON.parse(existing):{words:[],notes:[],folders:[],aiLog:[],grave:[],tagList:[]};
  const incoming=JSON.parse(storage[LS_KEY]);
  const merged=aMergeState(base,incoming),plan={[LS_KEY]:JSON.stringify(merged)};
  Object.keys(storage).forEach(k=>{if(k===LS_KEY||!k.startsWith('english-notes-')||typeof storage[k]!=='string'||SENSITIVE_BACKUP_KEYS.includes(k))return;plan[k]=aMergeExtra(k,localStorage.getItem(k),storage[k]);});
  /* 收件箱 key 不以 english-notes- 开头，单独合并 */
  if(typeof storage[SHOT_INBOX_KEY]==='string') plan[SHOT_INBOX_KEY]=aMergeExtra(SHOT_INBOX_KEY,localStorage.getItem(SHOT_INBOX_KEY),storage[SHOT_INBOX_KEY]);
  /* 落地配图不进 LS：取出原始 dataURL 包，从 plan 移除，稍后由 syncImportedBlobs 转 Blob 存 IDB */
  let imageBlobRaw=null;
  if(typeof storage[WM_IMG_BLOB_KEY]==='string'){
    imageBlobRaw=storage[WM_IMG_BLOB_KEY];
    delete plan[WM_IMG_BLOB_KEY];
  }
  return {plan,merged,added:merged.words.length-(base.words||[]).length,imageStats:aImageStatsFromStorage(storage),imageBlobRaw};
}
function aCommitImport(prepared){
  const before={};Object.keys(prepared.plan).forEach(k=>before[k]=localStorage.getItem(k));
  try{Object.keys(prepared.plan).forEach(k=>localStorage.setItem(k,prepared.plan[k]));}
  catch(e){Object.keys(before).forEach(k=>{if(before[k]===null)localStorage.removeItem(k);else localStorage.setItem(k,before[k]);});throw new Error('空间不足，导入已撤回，请先备份并释放空间');}
  state=migrate(prepared.merged);aData=aRead(A_KEY,{words:{},attempts:[]});ui.mode='today';ui.note=null;ui.wordDate='';applyTheme();render();
  syncImportedBlobs(prepared);
  const image=aImageCacheStats(wmImgAll(),state.words);
  $('#aBackupStatus').textContent='已补充 '+prepared.added+' 个表达；备份带来 '+(prepared.imageStats?prepared.imageStats.records:0)+' 条配图记录。当前共 '+state.words.length+' 个表达、'+shotsTotal(shotsAll())+' 张截图、'+image.records+' 条配图记录，已确认 '+image.confirmedWords+' 条。';
}
/* 导入后把合并的截图/收件箱同步到 IDB，并刷新内存缓存（IDB 不可用时它们已在 localStorage） */
async function syncImportedBlobs(prepared){
  try{
    await shotsInit(); await inboxInit();
    if(typeof prepared.plan[SHOTS_KEY]==='string'){
      const shots=JSON.parse(prepared.plan[SHOTS_KEY]);
      if(shotUseIdb){ shotCache=shots; await idbSet(IDB_STORE_SHOTS,'all',shots); }
    }
    if(typeof prepared.plan[SHOT_INBOX_KEY]==='string'){
      const inbox=JSON.parse(prepared.plan[SHOT_INBOX_KEY]);
      if(inboxUseIdb){
        for(const item of inbox){ await inboxPutItem(item); }
      }
    }
    /* 落地配图：dataURL -> Blob，逐个存 IDB images store；本机已有的不覆盖 */
    if(prepared.imageBlobRaw){
      let pack={};
      try{ pack=JSON.parse(prepared.imageBlobRaw); }catch(_){ pack={}; }
      const terms=Object.keys(pack);
      for(const term of terms){
        try{
          const exist=await imgBlobGet(term);
          if(exist&&exist.size)continue;
          const b=await fetch(pack[term]).then(r=>r.blob()).catch(()=>null);
          if(b)await imgBlobSet(term,b);
        }catch(_){}
      }
    }
  }catch(e){ console.error('导入截图同步失败',e); }
}
function aImportFile(file){
  if(!file)return;const fr=new FileReader();fr.onload=()=>{try{const p=aPrepareImport(JSON.parse(fr.result)),img=p.imageStats||{};showConfirm({title:'补充导入备份？',msg:'将补充 '+p.added+' 个表达，并带来 '+(img.records||0)+' 条配图记录，其中已确认 '+(img.confirmedWords||0)+' 条。同 ID／同表达的本机内容不覆盖。',okText:'补充导入',onOk(){try{aCommitImport(p);}catch(e){toast(e.message,'warn');}}});}catch(e){toast('导入失败：'+e.message,'warn');}};fr.readAsText(file);
}
function aOpenBackup(){const image=aImageCacheStats(wmImgAll(),state.words);$('#aBackupStatus').textContent='当前设备：'+state.words.length+' 个表达，'+shotsTotal(shotsAll())+' 张截图，'+image.records+' 条配图记录，已确认 '+image.confirmedWords+' 条，缺少 '+image.missingWords+' 个词条。';$('#aBackup').classList.add('show');}
function aOpenWords(filter,date){ui.mode='words';ui.wordFilter=filter||'all';ui.wordDate=date||'';ui.sel=[];ui.selMode=false;render();}
const aOriginalOpenWord=openWordModal;
openWordModal=function(term,note,range,existing,prefill,restore){
  aOriginalOpenWord(term,note,range,existing,prefill,restore);
};
const aOriginalSaveWord=saveWord;
saveWord=function(){
  aOriginalSaveWord();
  if(!wmState.saved)return;
  const w=state.words.find(x=>String(x.term||'').trim().toLowerCase()===String(wmState.term||'').trim().toLowerCase());
  if(w){ aPut(w.id, {stage:'learning'}); firstShotSaved(w); render(); }
};
const aOriginalWordsPane=renderWordsPane;
renderWordsPane=function(){
  aOriginalWordsPane();const box=$('#noteList');const tools=document.createElement('div');tools.className='a-tools';
  tools.innerHTML='<label for="aWordDate">收集日期</label><input id="aWordDate" type="date" value="'+esc(ui.wordDate||'')+'"><button class="btn" id="aDateClear">全部日期</button><button class="btn" id="aDateSpeak">练这一批</button><button class="btn" id="aDateWrite">写这一批</button><button class="btn" id="aWordNew">＋ 手动表达</button>';
  box.prepend(tools);
  $('#aWordDate').onchange=e=>{ui.wordDate=e.target.value;ui.wordFilter='all';if(ui.wordFilterOpen)wfCloseSheet();renderWordsPane();};
  $('#aDateClear').onclick=()=>{ui.wordDate='';if(ui.wordFilterOpen)wfCloseSheet();renderWordsPane();};
  $('#aWordNew').onclick=aNewWord;
  $('#aDateSpeak').onclick=()=>{const words=aSelectedWords();if(!words.length){toast('先整理至少一个表达','warn');return;}openAiPackPractice(words.slice(0,3));};
  $('#aDateWrite').onclick=()=>{const words=aSelectedWords();if(!words.length){toast('先整理至少一个表达','warn');return;}aOpenWriteWith(words.slice(0,6));};
  if(ui.wordDate){const p=document.createElement('p');p.className='a-note';p.textContent='正在查看 '+ui.wordDate+' 收集的表达；练习优先使用多选项，未多选时使用当前筛选结果。';tools.after(p);}
  wfSync();
};
