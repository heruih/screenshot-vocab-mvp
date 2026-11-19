
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

/* ============ 统一数据保护卡片（融合"装桌面"与"导出备份"，按用户倾向智能切换重点） ============ */
const SAFETY_KEY='en-data-safety-v1', PWA_VISIT_KEY='en-pwa-visit-count-v1';
let pwaDeferredPrompt=null, launchFingerprint='';
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
/* 数据指纹：词/笔记/收件箱/截图数量，用来判断本次会话有没有新改动 */
function dataFingerprint(){
  try{
    const words=(typeof state!=='undefined'&&state.words)?state.words.length:0;
    const notes=(typeof state!=='undefined'&&state.notes)?state.notes.length:0;
    const inbox=(typeof ocrInboxRead==='function')?ocrInboxRead().length:0;
    const shots=(typeof shotsAll==='function')?shotsAll().length:0;
    return words+':'+notes+':'+inbox+':'+shots;
  }catch(_){ return ''; }
}
function doExport(){
  try{
    if(typeof aDownloadBackup==='function') aDownloadBackup();
    else if(typeof exportData==='function') exportData();
    const s=readSafety(); s.lastBackupAt=Date.now(); writeSafety(s);
    launchFingerprint=dataFingerprint(); // 导出后重置基准，避免重复提醒
  }catch(e){ if(typeof toast==='function') toast('导出失败：'+e.message,'warn'); }
}
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
function showDataSafety(reason){
  try{
    if(CAP.standalone)return;
    const {ios,android}=pwaPlatform();
    if(!ios&&!android)return;
    const s=readSafety();
    if(s.installed)return;
    if(reason==='resume' && dataFingerprint()===launchFingerprint)return; // 没新改动不打扰
    if(document.querySelector('.pwa-guide'))return;

    const preferExport=s.installIgnored>=2; // 两次忽略安装 → 判定不想装，主推导出
    const card=document.createElement('div');
    card.className='pwa-guide'; card.setAttribute('role','dialog');
    card.innerHTML=
      '<div class="pwa-guide-head"><b>保护你的学习数据</b>'+
      '<button type="button" class="pwa-guide-x" aria-label="关闭">×</button></div>'+
      '<p class="pwa-guide-sub">浏览器里的数据可能被系统定期清除；装到桌面有独立存储，或导出一份备份更稳妥。</p>'+
      '<div class="pwa-guide-act"></div>';
    const act=card.querySelector('.pwa-guide-act');
    const close=()=>card.remove();
    const ignore=()=>{ const z=readSafety(); z.installIgnored++; writeSafety(z); close(); };
    card.querySelector('.pwa-guide-x').addEventListener('click',ignore);

    const mkBtn=(txt,primary)=>{
      const b=document.createElement('button');
      b.type='button'; b.className='pwa-btn'+(primary?' primary':''); b.textContent=txt;
      return b;
    };
    const mkLink=(txt)=>{
      const b=document.createElement('button');
      b.type='button'; b.className='pwa-link'; b.textContent=txt;
      return b;
    };
    const installGuideBtn=mkBtn('装到桌面，数据不丢',true);
    installGuideBtn.addEventListener('click',async()=>{
      if(android){ await androidInstall(); close(); }
      else{
        const existing=card.querySelector('.pwa-steps');
        if(existing){ existing.remove(); return; }
        act.parentNode.insertBefore(installStepsEl(ios),act);
      }
    });

    if(!preferExport){
      // 主推安装 + 导出兜底
      act.appendChild(installGuideBtn);
      const row=document.createElement('div'); row.className='pwa-mini-row';
      const exportMini=mkLink('先导出备份');
      exportMini.addEventListener('click',()=>{ doExport(); close(); });
      const okMini=mkLink('知道了');
      okMini.addEventListener('click',ignore);
      row.appendChild(exportMini); row.appendChild(okMini);
      act.parentNode.insertBefore(row,act.nextSibling);
    }else{
      // 主推导出 + 安装降为小字链接
      const exportBtn=mkBtn('立即导出备份',true);
      exportBtn.addEventListener('click',()=>{ doExport(); close(); });
      act.appendChild(exportBtn);
      const link=mkLink('或装到桌面，一劳永逸');
      link.addEventListener('click',async()=>{
        if(android){ await androidInstall(); close(); }
        else{
          const existing=card.querySelector('.pwa-steps');
          if(existing){ existing.remove(); return; }
          act.parentNode.insertBefore(installStepsEl(ios),act);
        }
      });
      const okMini=mkLink('知道了'); okMini.addEventListener('click',ignore);
      const wrap=document.createElement('div'); wrap.className='pwa-link-row';
      wrap.appendChild(link); wrap.appendChild(okMini);
      act.parentNode.insertBefore(wrap,act.nextSibling);
    }
    document.body.appendChild(card);
  }catch(_){}
}
/* 启动：第 2 次启动才提示，先让用户体验；同时记录启动指纹 */
function dataSafetyLaunch(){
  try{
    launchFingerprint=dataFingerprint();
    const visits=(Number(localStorage.getItem(PWA_VISIT_KEY))||0)+1;
    localStorage.setItem(PWA_VISIT_KEY,String(visits));
    if(CAP.standalone) return;
    if(visits<2) return;
    showDataSafety('launch');
  }catch(_){}
}
/* 回到前台：本次有新改动且没装时，提醒"用完"备份 */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') showDataSafety('resume');
});
