/* ============ 启动 ============ */
state=migrate(load());
try{accountInit();}catch(e){console.error('账号模块初始化失败',e);}
try{aInit();}catch(e){console.error('学习模块初始化失败',e);}
try{bInit();}catch(e){console.error('同步模块初始化失败',e);}
try{aiDialogueHistoryMigrate();}catch(e){}
/* 截图/收件箱迁移到 IndexedDB（异步加载，不阻塞首屏；未就绪时同步兜底读 localStorage） */
try{ shotsInit(); }catch(e){}
try{ inboxInit(); }catch(e){}
/* TTS 音频缓存从 localStorage 搬到 IDB（异步、不阻塞首屏，失败保留 LS 兜底） */
try{ ttsCacheMigrate(); }catch(e){}
applyTheme();
try{ applyLookPrefs(); }catch(e){ console.error('外观偏好应用失败',e); }
// Preserve existing image cache on upgrade.
/* 老标亮（标了词就到处亮）搬迁成「只亮当时那一处」 */
// Preserve existing highlights on upgrade.
if(!localStorage.getItem(LS_KEY)) save();
try{bindEvents();}catch(e){console.error('界面事件绑定失败',e);}
try{personaBind();}catch(e){console.error('学习身份绑定失败',e);}
try{initFeedback();}catch(e){console.error('意见反馈初始化失败',e);}
try{bindSideSwipe();}catch(e){console.error('侧滑绑定失败',e);}
try{bindPageSwipe();}catch(e){console.error('页面左右滑绑定失败',e);}
try{bindTabbarSwipe();}catch(e){console.error('底部横滑绑定失败',e);}
try{bindEditorSwipe();}catch(e){console.error('编辑器左滑绑定失败',e);}
try{bindEdgeDrawerSwipe();}catch(e){console.error('边缘抽屉手势绑定失败',e);}
try{bindSystemClipGuard();}catch(e){console.error('系统剪切拦截绑定失败',e);}
try{initDrag();}catch(e){console.error('拖拽模块初始化失败',e);}
try{render();}catch(e){console.error('页面渲染失败',e);const box=document.querySelector('#noteList');if(box)box.innerHTML='<div class="empty-state"><b>页面初始化没有完成</b><br>请刷新页面；如果仍为空，请从旧文件导出完整备份后导入。</div>';}
Promise.all([shotsInit(),inboxInit()]).catch(()=>{}).then(()=>{
  try{ if(['words','flash','list'].includes(ui.mode)) render(); }catch(_){}
});
syncKbUI();
/* 全新用户首屏后弹身份选择（老用户不弹） */
try{ personaMaybeShow(); }catch(e){}
setTimeout(backupReminder,1600);
setTimeout(dataSafetyLaunch,2200);
/* 首屏稳定后再启动存量配图落地，后台静默、不抢资源、不影响使用 */
setTimeout(()=>{ try{ imgBackfillSchedule(); }catch(_){} },6000);
syncOnBoot();

/* 页面被切走 / 直接关掉（没点保存）：先把 empower 草稿落盘 */
window.addEventListener('pagehide',()=>{ try{ if(wmState&&!wmState.saved) wmDraftSave(); }catch(_){ } });
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){ try{ if(wmState&&!wmState.saved) wmDraftSave(); }catch(_){ } }
});

/* 注册 Service Worker：PWA 秒开与离线缓存，失败不影响主功能 */
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{ try{ if(navigator.serviceWorker && navigator.serviceWorker.register){ const p=navigator.serviceWorker.register('sw.js'); if(p&&p.catch)p.catch(()=>{}); } }catch(e){} });
}


