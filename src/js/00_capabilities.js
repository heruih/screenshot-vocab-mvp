
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

/* ============ PWA 安装引导（仅移动设备、未安装时；根治 iOS 7 天数据驱逐） ============ */
const PWA_INSTALL_KEY='en-pwa-install-state-v1', PWA_VISIT_KEY='en-pwa-visit-count-v1';
let pwaDeferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); pwaDeferredPrompt=e; });
window.addEventListener('appinstalled',()=>{ try{localStorage.setItem(PWA_INSTALL_KEY,'installed');}catch(_){} });
function pwaPlatform(){
  const ua=navigator.userAgent||'';
  return { ios:/iphone|ipad|ipod/i.test(ua), android:/android/i.test(ua) };
}
function maybeShowInstallGuide(){
  try{
    if(CAP.standalone) return;
    const {ios,android}=pwaPlatform();
    if(!ios && !android) return;
    const st=localStorage.getItem(PWA_INSTALL_KEY);
    if(st==='installed'||st==='dismissed') return;
    const visits=(Number(localStorage.getItem(PWA_VISIT_KEY))||0)+1;
    localStorage.setItem(PWA_VISIT_KEY,String(visits));
    if(visits<2) return; // 第 2 次启动才提示，先让用户体验

    const card=document.createElement('div');
    card.className='pwa-guide'; card.setAttribute('role','dialog');
    card.innerHTML=
      '<div class="pwa-guide-head"><b>装到手机桌面，数据不丢</b>'+
      '<button type="button" class="pwa-guide-x" aria-label="关闭">×</button></div>'+
      '<p class="pwa-guide-sub">浏览器里的网页数据可能在一段时间不访问后被系统自动清除；装到桌面后有独立存储，还能全屏打开。</p>'+
      '<div class="pwa-guide-act"></div>';
    const act=card.querySelector('.pwa-guide-act');
    const dismiss=()=>{ card.remove(); try{localStorage.setItem(PWA_INSTALL_KEY,'dismissed');}catch(_){} };
    card.querySelector('.pwa-guide-x').addEventListener('click',dismiss);

    if(android && pwaDeferredPrompt){
      const btn=document.createElement('button');
      btn.type='button'; btn.className='pwa-btn primary'; btn.textContent='立即安装';
      btn.addEventListener('click',async()=>{
        pwaDeferredPrompt.prompt();
        await pwaDeferredPrompt.userChoice;
        pwaDeferredPrompt=null; dismiss();
      });
      act.appendChild(btn);
    }else{
      const steps=document.createElement('div');
      steps.className='pwa-steps';
      steps.textContent=ios
        ? '点浏览器底部的「分享」按钮（方框向上箭头），在弹出菜单里选「添加到主屏幕」，再点「添加」。'
        : '点浏览器菜单（右上角三个点），选「添加到主屏幕」。';
      const ok=document.createElement('button');
      ok.type='button'; ok.className='pwa-btn primary'; ok.textContent='知道了';
      ok.addEventListener('click',dismiss);
      act.appendChild(steps); act.appendChild(ok);
    }
    document.body.appendChild(card);
  }catch(_){}
}
