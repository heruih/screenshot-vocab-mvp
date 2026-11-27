
/* ===== 00_capabilities.js · 运行环境能力检测（最早执行，结果冻结供全局判断） ===== */

'use strict';
const CAP=(function(){
  // 用一个含 v128 指令的最小 wasm 模块探测 SIMD，不实例化、不执行
  function hasWasmSimd(){
    try{
      const probe=new Uint8Array([
        0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,
        0x01,0x05,0x01,0x60,0x00,0x01,0x7b,
        0x03,0x02,0x01,0x00,
        0x0a,0x0a,0x01,0x08,0x00,0x41,0x00,0xfd,0x0f,0xfd,0x62,0x0b]);
      return typeof WebAssembly==='object' && WebAssembly.validate(probe);
    }catch(_){ return false; }
  }
  function hasCanvas2d(){
    try{ const c=document.createElement('canvas'); return !!(c.getContext && c.getContext('2d')); }catch(_){ return false; }
  }
  const c={
    wasm: typeof WebAssembly==='object',
    simd: hasWasmSimd(),
    idb: typeof window.indexedDB!=='undefined' && !!window.indexedDB,
    canvas: hasCanvas2d(),
    blob: typeof Blob==='function' && typeof URL!=='undefined' && typeof URL.createObjectURL==='function',
    // 是否已作为主屏 App 安装（iOS 安装后才有独立存储、豁免 7 天驱逐）
    standalone: (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone===true,
  };
  // OCR 引擎强制 SIMD：wasm 与 SIMD 都具备才可用，否则走手动输入
  c.ocr = c.wasm && c.simd;
  return Object.freeze(c);
})();

/* 启动时按能力缺失给出非阻塞顶部提示（正常手机不显示）；关闭状态用独立 key 记住 */
function capBanner(){
  try{
    const msgs=[];
    if(!CAP.canvas || !CAP.blob) msgs.push('当前浏览器缺少运行所需能力，部分功能可能无法使用，请更换浏览器。');
    if(!CAP.idb) msgs.push('存储受限（仅约 5MB），建议用最新版浏览器打开，避免截图存不下。');
    if(!CAP.ocr) msgs.push('不支持截图自动识别，可手动输入表达；升级系统（iOS 16.4+ / Chrome 91+）可自动识别。');
    if(!msgs.length) return;
    const KEY='en-cap-banner-dismissed-v1';
    if(localStorage.getItem(KEY)===msgs.join('|')) return;
    const bar=document.createElement('div');
    bar.className='cap-banner';
    bar.setAttribute('role','alert');
    bar.innerHTML='<span class="cap-banner-txt"></span><button type="button" class="cap-banner-x" aria-label="关闭提示">×</button>';
    bar.querySelector('.cap-banner-txt').textContent=msgs.join(' ');
    bar.querySelector('.cap-banner-x').addEventListener('click',()=>{
      bar.remove();
      try{ localStorage.setItem(KEY,msgs.join('|')); }catch(_){}
    });
    document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(bar));
    if(document.body) document.body.appendChild(bar);
  }catch(_){}
}
capBanner();

/* ============ 半强制「安装到主屏幕」引导 + 侧边栏永久入口 ============ */
const SAFETY_KEY='en-data-safety-v1', PWA_VISIT_KEY='en-pwa-visit-count-v1';
/* 半强制流程独立 key（不碰旧数据、可回滚）：首次是否已弹、暂不次数、上次暂不日期、是否降频 */
const INSTALL_UI_KEY='en-pwa-install-prompt-v1';
let pwaDeferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); pwaDeferredPrompt=e; });
window.addEventListener('appinstalled',()=>{ try{const s=readSafety();s.installed=true;writeSafety(s);}catch(_){} });
function readSafety(){
  try{ return Object.assign({installIgnored:0,lastBackupAt:0,installed:false},JSON.parse(localStorage.getItem(SAFETY_KEY)||'{}')); }
  catch(_){ return {installIgnored:0,lastBackupAt:0,installed:false}; }
}
function writeSafety(s){ try{ localStorage.setItem(SAFETY_KEY,JSON.stringify(s)); }catch(_){} }
function pwaPlatform(){
  const ua=navigator.userAgent||'';
  return { ios:/iphone|ipad|ipod/i.test(ua), android:/android/i.test(ua) };
}
function pwaInstallState(){
  try{ return Object.assign({firstShown:false,deferCount:0,lastDeferDay:'',downgraded:false},JSON.parse(localStorage.getItem(INSTALL_UI_KEY)||'{}')); }
  catch(_){ return {firstShown:false,deferCount:0,lastDeferDay:'',downgraded:false}; }
}
function pwaInstallSave(p){ try{ localStorage.setItem(INSTALL_UI_KEY,JSON.stringify(p)); }catch(_){} }
function pwaDayStr(){ const d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function installStepsEl(ios){
  const d=document.createElement('div');
  d.className='pwa-steps';
  d.textContent=ios
    ? '点浏览器底部「分享」按钮（方框向上箭头），在弹出菜单里选「添加到主屏幕」，再点「添加」。'
    : '点浏览器菜单（右上角三个点），选「添加到主屏幕」。';
  return d;
}
async function androidInstall(){
  if(pwaDeferredPrompt){
    pwaDeferredPrompt.prompt();
    await pwaDeferredPrompt.userChoice;
    pwaDeferredPrompt=null;
  }
}
/* 安装动作：安卓直接唤起系统安装并返回 true；iOS 在容器内展开分步引导（返回 false，不关闭） */
async function pwaInstallAction(container){
  const {ios,android}=pwaPlatform();
  if(android){ await androidInstall(); return true; }
  if(ios){
    const existing=container.querySelector('.pwa-steps');
    if(existing){ existing.remove(); return false; }
    container.appendChild(installStepsEl(true));
    return false;
  }
  return false;
}
/* 是否已经有任何数据（词/笔记/收件箱/截图） */
function pwaHasData(){
  try{
    const words=(typeof state!=='undefined'&&state.words)?state.words.length:0;
    const notes=(typeof state!=='undefined'&&state.notes)?state.notes.length:0;
    const inbox=(typeof ocrInboxRead==='function')?ocrInboxRead().length:0;
    // shotsAll() 返回按词分组的对象（非数组），总数用 shotsTotal 统计
    const shots=(typeof shotsAll==='function'&&typeof shotsTotal==='function')?shotsTotal(shotsAll()):0;
    return (Number(words)||0)+(Number(notes)||0)+(Number(inbox)||0)+(Number(shots)||0)>0;
  }catch(_){ return false; }
}
/* 半强制卡片：无一键关闭，主按钮安装 + 弱化「暂不，下次提醒」，始终不阻断功能 */
function showInstallPrompt(){
  try{
    if(CAP.standalone||firstGuideInProgress())return false;
    const {ios,android}=pwaPlatform();
    if(!ios&&!android)return false;
    if(readSafety().installed)return false;
    if(document.querySelector('.pwa-guide'))return false;
    const card=document.createElement('div');
    card.className='pwa-guide';card.setAttribute('role','dialog');
    card.innerHTML=
      '<div class="pwa-guide-head"><b>把 App 装到主屏幕</b></div>'+
      '<p class="pwa-guide-sub">浏览器里的数据可能被系统自动清除；装到主屏幕后有独立存储、数据更安全，还能离线打开。</p>'+
      '<div class="pwa-guide-act">'+
        '<button type="button" class="pwa-btn primary" id="pwaInstallGo">添加到主屏幕</button>'+
        '<button type="button" class="pwa-link" id="pwaInstallDefer">暂不安装，下次提醒</button>'+
      '</div>';
    document.body.appendChild(card);
    const close=()=>card.remove();
    card.querySelector('#pwaInstallGo').addEventListener('click',async()=>{
      const done=await pwaInstallAction(card);
      if(done)close();
    });
    card.querySelector('#pwaInstallDefer').addEventListener('click',()=>{
      const p=pwaInstallState();
      p.deferCount++;p.lastDeferDay=pwaDayStr();
      if(p.deferCount>=3)p.downgraded=true;
      pwaInstallSave(p);close();
    });
    return true;
  }catch(_){ return false; }
}
/* 首次数据：第一次产生词/笔记/截图后立刻弹（render 后调用，只弹一次） */
function pwaFirstDataMaybe(){
  try{
    if(CAP.standalone)return;
    const p=pwaInstallState();
    if(p.firstShown)return;
    if(!pwaHasData())return;
    if(showInstallPrompt()){ p.firstShown=true; pwaInstallSave(p); }
  }catch(_){}
}
/* 启动重试：首次弹过、点了暂不，隔天再弹；当天冷却、连续 3 次降频后不再主动弹 */
function pwaDailyMaybe(){
  try{
    if(CAP.standalone)return;
    const {ios,android}=pwaPlatform();if(!ios&&!android)return;
    if(readSafety().installed)return;
    const p=pwaInstallState();
    if(!p.firstShown||p.downgraded)return;
    if(p.lastDeferDay===pwaDayStr())return;
    showInstallPrompt();
  }catch(_){}
}
/* 侧边栏永久入口（带警告），与「使用小手册」并列；已安装则不显示 */
function pwaInstallEntry(){
  try{
    const sideNav=document.getElementById('sideNav');
    if(!sideNav||document.getElementById('pwaInstallEntry'))return;
    if(CAP.standalone||readSafety().installed)return;
    const {ios,android}=pwaPlatform();if(!ios&&!android)return;
    const b=document.createElement('button');
    b.type='button';b.id='pwaInstallEntry';b.className='a-guide-hero';
    b.innerHTML=
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'+
      '<span class="agh-copy"><b>装到主屏幕</b><small class="agh-warn" id="pwaInstallWarn">网页数据会被系统清除，不装数据很可能丢失</small></span>';
    b.addEventListener('click',async()=>{ await pwaInstallAction(b); });
    const guide=document.getElementById('aGuideOpen');
    if(guide&&guide.parentNode===sideNav)sideNav.insertBefore(b,guide.nextSibling);
    else sideNav.insertBefore(b,sideNav.firstChild);
  }catch(_){}
}
/* 启动（保留访问计数）：挂永久入口 + 当天重试；首次数据由 render 流程触发 */
function dataSafetyLaunch(){
  try{
    const visits=(Number(localStorage.getItem(PWA_VISIT_KEY))||0)+1;
    localStorage.setItem(PWA_VISIT_KEY,String(visits));
    if(CAP.standalone)return;
    pwaInstallEntry();
    pwaDailyMaybe();
  }catch(_){}
}
/* 回到前台：补检首次数据（不重复主动弹窗，避免打扰） */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')pwaFirstDataMaybe();
});
