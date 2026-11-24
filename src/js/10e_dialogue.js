const BATCH_KEY='english-notes-dialogue-batch-v1';
const DIALOGUE_PREF_KEY='english-notes-dialogue-preferences-v1';
const AI_DIALOGUE_HISTORY_KEY='english-notes-dialogue-history-v1';
let batchActiveGroup=-1,batchActiveSegment=null;
function aiDialogueHistoryRead(){const v=aRead(AI_DIALOGUE_HISTORY_KEY,{sessions:[],favorites:[]});return {sessions:[],favorites:Array.isArray(v&&v.favorites)?v.favorites:[]};}
function aiDialogueHistoryWrite(v){v.sessions=[];v.favorites=(v.favorites||[]).slice(0,30);aStore(AI_DIALOGUE_HISTORY_KEY,JSON.stringify(v));}
let aiSessionDoc=null;
function aiDialogueHistoryMigrate(){
  /* 旧版本会自动存 30 段会话；现在只保留收藏，启动时顺手清掉旧的自动记录 */
  try{
    const raw=aRead(AI_DIALOGUE_HISTORY_KEY,null);
    if(raw&&Array.isArray(raw.sessions)&&raw.sessions.length){
      aStore(AI_DIALOGUE_HISTORY_KEY,JSON.stringify({sessions:[],favorites:(raw.favorites||[]).slice(0,30)}));
    }
  }catch(e){}
}
function aiDialogueHistoryStart(words){
  const list=Array.isArray(words)?words:[];
  aiSessionDoc={id:uid(),createdAt:Date.now(),updatedAt:Date.now(),status:'active',terms:list.map(w=>w.term),termIds:list.map(w=>w.id),scenes:[],turns:[]};
  aiState.dialogueSessionId=aiSessionDoc.id; return aiSessionDoc.id;
}
function aiDialogueHistoryScene(scene,lines,words){
  if(!aiSessionDoc) return;
  aiSessionDoc.updatedAt=Date.now();
  aiSessionDoc.scenes=aiSessionDoc.scenes||[];
  aiSessionDoc.scenes[Math.max(0,Number(aiState.sceneIndex)||0)]={title:scene&&scene.title||'情景练习',desc:scene&&scene.desc||'',wordIds:(words||[]).map(w=>w.id||w),lines:(lines||[]).map(l=>({who:l.who,en:l.en||'',cn:l.cn||'',wordId:l.wordId||'',promptCn:l.promptCn||''}))};
}
function aiDialogueHistoryTurn(data){
  if(!aiSessionDoc) return;
  aiSessionDoc.updatedAt=Date.now();
  aiSessionDoc.turns=aiSessionDoc.turns||[];
  aiSessionDoc.turns.push(Object.assign({createdAt:Date.now()},data||{}));
  const scene=aiSessionDoc.scenes&&aiSessionDoc.scenes[Number(aiState.sceneIndex)||0];
  if(scene&&Array.isArray(scene.lines)){const line=scene.lines.find(l=>l.who==='YOU'&&l.wordId===(data&&data.wordId));if(line){line.attempt=data.attempt||'';line.result=data.result||'';}}
}
function aiDialogueHistoryFinish(status){
  if(!aiSessionDoc) return;
  aiSessionDoc.status=status||'completed';
  aiSessionDoc.updatedAt=Date.now();
}
function aiFavoriteCurrent(){
  if(!aiSessionDoc){toast('当前还没有可收藏的对话','warn');return;}
  const v=aiDialogueHistoryRead();
  const copy=JSON.parse(JSON.stringify(Object.assign({},aiSessionDoc,{favoriteAt:Date.now()})));
  v.favorites=[copy].concat(v.favorites.filter(x=>x.id!==copy.id));
  aiDialogueHistoryWrite(v);
  aiState.dialogueFavorited=true;
  const b=$('#aiFavorite');if(b){b.textContent='已收藏';b.disabled=true;}
  toast('已收藏这段对话');
}
function aiFavListView(){
  const v=aiDialogueHistoryRead(),box=$('#aiFavoritesBody');if(!box)return;
  if(!v.favorites.length){box.innerHTML='<div class="empty-state">还没有收藏的对话。进入 AI 对话后，点“收藏对话”即可保存。</div>';return;}
  box.innerHTML=v.favorites.map((s,i)=>{
    const scs=(s.scenes||[]).filter(Boolean);
    const lines=scs.reduce((n,sc)=>n+((sc.lines||[]).length),0);
    return '<button class="fav-row" data-fav="'+i+'"><span class="fav-row-main"><span class="fav-row-title">'+esc((s.terms||[]).join(' · ')||'情景对话')+'</span><span class="fav-row-meta">'+esc(aDate(s.favoriteAt||s.createdAt))+' · '+esc(s.status==='completed'?'已完成':'练习中')+' · '+scs.length+' 个场景 '+lines+' 行</span></span><span class="fav-row-arrow">›</span></button>';
  }).join('');
  $$('#aiFavoritesBody [data-fav]').forEach(b=>b.onclick=()=>aiFavDetailView(Number(b.dataset.fav)));
}
function aiFavDetailView(idx){
  const v=aiDialogueHistoryRead(),s=v.favorites[idx],box=$('#aiFavoritesBody');if(!s||!box)return;
  const scs=(s.scenes||[]).filter(Boolean);
  box.innerHTML='<div class="fav-detail-head"><button class="btn" id="favBack">‹ 返回</button><b>'+esc((s.terms||[]).join(' · ')||'情景对话')+'</b></div>'+
    '<div class="ai-favorite-meta">'+esc(aDate(s.favoriteAt||s.createdAt))+' · '+esc(s.status==='completed'?'已完成':'练习中')+'</div>'+
    scs.map(sc=>'<div class="ai-favorite-scene"><div class="ai-favorite-scene-title">'+esc(sc.title||'情景练习')+'</div>'+
      ((sc.lines||[]).map(l=>l.who==='YOU'?'<div class="ai-favorite-line you">你说：'+esc(l.promptCn||'')+(l.attempt?' → '+esc(l.attempt):'')+'</div>':'<div class="ai-favorite-line">'+esc(l.en||'')+(l.cn?' · '+esc(l.cn):'')+'</div>').join(''))+'</div>').join('');
  const back=$('#favBack'); if(back) back.onclick=aiFavListView;
}
function aiOpenFavorites(){
  aiFavListView();
  $('#aiFavoritesModal').classList.add('show');
}
function dialoguePrefs(){const p=aRead(DIALOGUE_PREF_KEY,{});const n=Number(p&&p.threshold);return {threshold:Number.isFinite(n)?Math.max(3,Math.min(10,Math.round(n))):3};}
function dialogueThreshold(){return dialoguePrefs().threshold;}
function saveDialogueThreshold(value){const n=Math.max(3,Math.min(10,Math.round(Number(value)||3)));aStore(DIALOGUE_PREF_KEY,JSON.stringify({threshold:n}));return n;}
function batchEmpty(){return {date:aDate(Date.now()),wordIds:[],recentIds:[],segmentHistory:[],activeSegment:null,plan:null,completed:[],active:-1};}
function dialogueBatchState(){const d=aRead(BATCH_KEY,null);if(d&&d.date===aDate(Date.now())&&Array.isArray(d.wordIds))return Object.assign(batchEmpty(),d);const fresh=batchEmpty();aStore(BATCH_KEY,JSON.stringify(fresh));return fresh;}
function batchSave(d){aStore(BATCH_KEY,JSON.stringify(d));}
function batchReviewedWords(d){const ids=new Set((d||dialogueBatchState()).wordIds||[]);return state.words.filter(w=>ids.has(w.id)&&!aPending(w));}
function batchReviewRecord(id){if(!id)return;const d=dialogueBatchState();if(!d.wordIds.includes(id)){d.wordIds.push(id);d.plan=null;d.completed=[];d.active=-1;}if(!d.recentIds.includes(id))d.recentIds.push(id);batchSave(d);}
function batchRecentCount(){const d=dialogueBatchState();return Array.isArray(d.recentIds)?d.recentIds.length:0;}
function batchContinueRecent(){const d=dialogueBatchState();d.recentIds=[];d.activeSegment=null;batchSave(d);if(typeof renderFlash==='function')renderFlash();}
function batchPauseRecent(){
  const d=dialogueBatchState(),ids=(d.recentIds||[]).slice();
  if(ids.length<dialogueThreshold()){toast('至少复习 '+dialogueThreshold()+' 个词后再暂停练习','warn');return;}
  const words=ids.map(id=>state.words.find(w=>w.id===id)).filter(Boolean);
  if(words.length<dialogueThreshold()){toast('最近复习的词条已发生变化，请继续复习','warn');return;}
  d.activeSegment={ids:words.map(w=>w.id),startedAt:Date.now()};batchSave(d);batchActiveSegment=words.map(w=>w.id);openAiPackPractice(words);
}
function batchReady(d){const n=batchReviewedWords(d).length;return n>=20||(dueCount()===0&&n>=5);}
function batchFallbackPlan(words){const groups=[];for(let i=0;i<words.length;i+=5){const part=words.slice(i,i+5);groups.push({title:'情景对话 '+(groups.length+1),desc:'把这组表达自然用进同一个场景',wordIds:part.map(w=>w.id)});}return {groups};}
function batchPlanValid(plan,words){
  if(!plan||!Array.isArray(plan.groups)||!plan.groups.length)return false;
  const allowed=new Set(words.map(w=>w.id)),seen=[];
  for(const g of plan.groups){if(!g||typeof g.title!=='string'||typeof g.desc!=='string'||!Array.isArray(g.wordIds)||!g.wordIds.length||g.wordIds.length>6)return false;for(const id of g.wordIds){if(!allowed.has(id)||seen.includes(id))return false;seen.push(id);}}
  return seen.length===allowed.size&&seen.every(id=>allowed.has(id));
}
async function batchPlanToday(){
  const d=dialogueBatchState(),words=batchReviewedWords(d);
  if(words.length<5){toast('至少完成 5 个复习词后再规划情景','warn');return;}
  const fallback=()=>{d.plan=batchFallbackPlan(words);d.completed=[];d.active=-1;batchSave(d);batchRender();};
  if(!aAiReady()){fallback();toast('未配置自动 AI，已按每组 5 个词生成练习分组','warn');return;}
  const body=words.map(w=>({wordId:w.id,term:w.term,definition:(w.definition||'').split('\n')[0],example:(w.examples&&w.examples[0]&&w.examples[0].en)||''}));
  const prompt='今天已经复习了这些英语表达：'+JSON.stringify(body)+'。请按真实使用场景把它们分成若干组，每组 4—6 个，尽量每组约 5 个。每个词必须且只能出现一次，场景之间不要重复。优先按语境和用途分组，不要为了凑数制造奇怪场景。严格输出 JSON：{"groups":[{"title":"6字以内的中文场景名","desc":"20字以内说明","wordIds":["原样保留的词条ID"]}]}';
  const box=$('#aBatchBody');if(box)box.innerHTML='<div class="empty-state"><div class="spinner"></div><div>正在按真实语境分组…</div></div>';
  try{const r=await aiCall([{role:'system',content:'你是英语学习计划设计者。只输出 JSON 对象，不要 markdown，不要解释。'},{role:'user',content:prompt}],{maxTokens:900,timeout:30000});if(!batchPlanValid(r,words))throw new Error('分组结果不完整');d.plan={groups:r.groups.map(g=>({title:g.title.trim(),desc:g.desc.trim(),wordIds:g.wordIds.slice()}))};d.completed=[];d.active=-1;batchSave(d);batchRender();toast('今日情景已规划完成');}catch(e){fallback();toast('AI 分组失败，已按每组 5 个词生成备用分组','warn');}
}
function batchOpen(){const el=$('#aBatch');if(!el)return;el.classList.add('show');batchRender();}
function batchClose(){const el=$('#aBatch');if(el)el.classList.remove('show');}
function batchRender(){
  const box=$('#aBatchBody');if(!box)return;const d=dialogueBatchState(),words=batchReviewedWords(d),done=new Set(d.completed||[]);
  if(!words.length){box.innerHTML='<div class="empty-state"><b>今天还没有完成的复习词</b><div>先完成今日复习，再统一练情景对话。</div></div>';return;}
  let h='<p class="a-note">今天已复习 '+words.length+' 个表达。AI 会把它们分成每组约 5 个的场景，完成后逐词记录是否独立用出。</p>';
  if(!d.plan)h+='<button class="btn primary batch-plan-btn" id="aBatchPlan">规划今日场景</button>';
  else h+='<div class="batch-group-list">'+d.plan.groups.map((g,i)=>'<div class="batch-group '+(done.has(i)?'done':'')+'"><div class="batch-group-top"><div><b>场景 '+(i+1)+' · '+esc(g.title)+'</b><small>'+esc(g.desc)+'</small></div><span>'+((done.has(i))?'已完成':g.wordIds.length+' 个词')+'</span></div><div class="batch-word-chips">'+g.wordIds.map(id=>{const w=state.words.find(x=>x.id===id);return w?'<span>'+esc(w.term)+'</span>':'';}).join('')+'</div><button class="btn '+(done.has(i)?'':'primary')+'" data-batch-group="'+i+'">'+(done.has(i)?'再练一遍':'开始这一组')+'</button></div>').join('')+'</div>';
  box.innerHTML=h;
  const plan=$('#aBatchPlan');if(plan)plan.onclick=batchPlanToday;
  $$('[data-batch-group]').forEach(b=>b.onclick=()=>batchStartGroup(Number(b.dataset.batchGroup)));
}
function batchStartGroup(index){const d=dialogueBatchState(),g=d.plan&&d.plan.groups&&d.plan.groups[index];if(!g)return;const words=g.wordIds.map(id=>state.words.find(w=>w.id===id)).filter(Boolean);if(!words.length)return;d.active=index;batchSave(d);batchActiveGroup=index;batchClose();openAiPackPractice(words);}
function batchMarkActiveGroup(){if(batchActiveGroup<0)return;const d=dialogueBatchState();if(!d.completed.includes(batchActiveGroup))d.completed.push(batchActiveGroup);d.active=-1;batchSave(d);batchActiveGroup=-1;}
function batchMarkActiveSegment(){if(!batchActiveSegment||!batchActiveSegment.length)return;const d=dialogueBatchState();const ids=batchActiveSegment.slice();d.segmentHistory=Array.isArray(d.segmentHistory)?d.segmentHistory:[];d.segmentHistory.push({ids,completedAt:Date.now()});d.recentIds=(d.recentIds||[]).filter(id=>!ids.includes(id));d.activeSegment=null;batchSave(d);batchActiveSegment=null;}
function batchAdvanceDialogueScene(){
  if(!aiState.multiTurn||!Array.isArray(aiState.scenes)) return false;
  const next=(Number(aiState.sceneIndex)||0)+1;
  if(next>=aiState.scenes.length) return false;
  aiState.sceneIndex=next;
  toast('当前场景完成，进入下一个场景');
  startScene(aiState.scenes[next]);
  return true;
}
/* 首页 AI 对话：优先用刚复习的词，不够就回退到期可练的词 */
function todayAiDialogue(){
  const d=dialogueBatchState();
  const recent=(d.recentIds||[]).map(id=>state.words.find(w=>w.id===id)).filter(Boolean);
  if(recent.length>=dialogueThreshold()){ batchPauseRecent(); return; }
  const fb=packableWords();
  if(fb&&fb.length){ openAiPackPractice(fb); }
  else toast('还没有可练的词，先去攒几个表达','warn');
}
renderToday=function(){
  $('#paneTitle').textContent='今日';$('#btnNewNote').style.display='none';
  const examView=personaIsExam();
  const pending=state.words.filter(aPending),due=dueList(),weak=aWeakWords(),box=$('#noteList');
  const quote=todayDailyQuote(),encouragement=todayEncouragement(pending.length,due.length,weak.length);
  const batch=dialogueBatchState(),reviewed=batchReviewedWords(batch).length,batchEntry=(batchReady(batch)||batch.plan)?'<div class="a-batch-entry"><div><b>今日批量情景对话</b><small>已完成复习 '+reviewed+' 个表达 · 每组约 5 个</small></div><button class="btn primary" id="aBatchOpen">'+(batch.plan?'继续场景练习':'规划今日场景')+'</button></div>':'';
  const inboxN=ocrInboxRead().length;
  const organizeN=pending.length+inboxN;
  const todayHero=
    '<div class="today-hero">'+
      '<div class="th-title">'+(examView?'今日错题':'今日任务')+'</div>'+
      '<div class="th-nums">'+
        '<div class="th-num"><b>'+due.length+'</b><span>'+(examView?'待重做':'待复习')+'</span></div>'+
        '<div class="th-num'+(organizeN?' hot':'')+'"><b>'+organizeN+'</b><span>待整理</span></div>'+
      '</div>'+
      '<div class="th-actions">'+
        '<button class="th-btn primary" type="button" id="thStart">'+(examView?'开始错题重做':'开始今日复习')+'</button>'+
        (organizeN?'<button class="th-btn" type="button" id="thOrganize">去整理</button>':'')+
      '</div>'+
    '</div>';
  const inboxEntry='<button class="inbox-entry'+(inboxN?' has-pending':'')+'" id="aInboxEntry" type="button"><span class="inbox-entry-main"><b>截图收件箱</b><small>'+(inboxN?inboxN+' 张待匹配截图':'已清空，点这里查看')+'</small></span><span class="inbox-entry-count">'+inboxN+'</span></button>';
  box.innerHTML=
    todayHero+
    '<section class="daily-quote" aria-label="每日一句"><div class="daily-quote-kicker">每日一句</div><p class="daily-quote-en">'+esc(quote.en)+'</p><p class="daily-quote-cn">'+esc(quote.cn)+'</p><p class="daily-quote-foot">'+esc(encouragement)+'</p></section>'+
    '<div class="home-quick">'+
      '<button class="home-quick-item" data-hq="recall" type="button"><span class="hq-t">场景回想</span><span class="hq-d">看场景说英文 · 先回忆</span></button>'+
      '<button class="home-quick-item" data-hq="note" type="button"><span class="hq-t">笔记</span><span class="hq-d">打开笔记列表 · 新建或继续写</span></button>'+
      '<button class="home-quick-item" data-hq="flash" type="button"><span class="hq-t">'+(examView?'错题本':'英文闪卡')+'</span><span class="hq-d">'+(examView?'没掌握的题再做一遍':'到期回想练习')+'</span></button>'+
      '<button class="home-quick-item" data-hq="write" type="button"><span class="hq-t">写作练习</span><span class="hq-d">选词出题 · AI 批改</span></button>'+
      '<button class="home-quick-item primary" data-hq="ai" type="button"><span class="hq-t">AI 对话</span><span class="hq-d">基于刚复习的词开口</span></button>'+
    '</div>'+
    inboxEntry+
    '<div class="rv-stats"><div class="rv-stat"><div class="n">'+pending.length+'</div><div class="l">待整理</div></div><div class="rv-stat hot"><div class="n">'+due.length+'</div><div class="l">'+(examView?'待重做':'到期回想')+'</div></div><div class="rv-stat"><div class="n">'+weak.length+'</div><div class="l">待再次输出</div></div></div>'+batchEntry+
    '<div class="today-actions">'+todayCard('organize','整理表达','补上自己的理解与句子',pending.length)+todayCard('recall','场景回想','看场景说英文 · 每轮最多 10 个',due.length)+todayCard('flash',examView?'错题本':'英文闪卡',examView?'没掌握的题再做一遍':'保留原来的认识与回想练习',due.length)+'</div>'+
    '<div class="a-tools"><button class="btn" id="aTodayWords">按日期回看</button><button class="btn" id="aTodayWrite">每周写一段</button><button class="btn" id="aTodayFavorites">收藏对话</button><button class="btn" id="aTodayNew">手动添加</button><button class="btn" id="aTodayBackup">完整备份／迁移</button></div>'+
    '<p class="a-note">普通日参考：视频与模仿 20 分钟 → 整理 8 分钟 → 回想 5 分钟 → 输出 7 分钟。每周 2 次情景练习、1 次写作，可替换当天部分任务。无需清空全部队列。</p>'+
    '<p class="a-note">AI：'+(aRoute()==='chatgpt'?'ChatGPT 往返模式；套餐和模型由 ChatGPT 账号决定。':'OpenAI API 模式；独立计费。')+' 新地址不会自动读取手机旧地址的数据。</p>'+
    (aRead(A_TASK_KEY,null)?'<div class="a-tools"><button class="btn" id="aResumeGpt">继续未完成的 ChatGPT 练习</button></div>':'')+
    (!state.words.length?'<div class="a-callout"><h3>先迁入手机旧词条</h3><p>在手机同一个浏览器打开旧站 → 设置 → 导出备份；回到这里点“完整备份／迁移”导入。旧站内容保留。</p><a class="btn" href="https://english-notes-82796.app.workbuddy.host/?sharecode=EIO75LBUTA" target="_blank" rel="noopener">打开你的旧站</a></div>':'');
  box.querySelectorAll('[data-hq]').forEach(b=>b.onclick=()=>{
    const g=b.dataset.hq;
    if(g==='recall')aStartRecall();
    else if(g==='note'){ persistEditor(); ui.mode='list'; ui.folder='all'; ui.note=null; ui.tag=null; ui.sideOpen=false; render(); }
    else if(g==='flash'){ui.mode='flash';ui.flash=null;render();}
    else if(g==='write')openWriteModal();
    else if(g==='ai')todayAiDialogue();
  });
  $('#aInboxEntry').onclick=ocrInboxShow;
  const thStart=$('#thStart');
  if(thStart)thStart.onclick=()=>{ui.mode='flash';ui.flash=null;render();};
  const thOrganize=$('#thOrganize');
  if(thOrganize)thOrganize.onclick=()=>{ if(inboxN)ocrInboxShow(); else aOpenWords('pending'); };
  const go=g=>{if(g==='organize')aOpenWords('pending');if(g==='recall')aStartRecall();if(g==='flash'){ui.mode='flash';ui.flash=null;render();}};
  $$('#noteList [data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  $('#aTodayWords').onclick=()=>aOpenWords('all');$('#aTodayWrite').onclick=()=>openWriteModal();$('#aTodayFavorites').onclick=aiOpenFavorites;$('#aTodayNew').onclick=aNewWord;$('#aTodayBackup').onclick=aOpenBackup;
  if($('#aBatchOpen'))$('#aBatchOpen').onclick=batchOpen;
  if($('#aResumeGpt'))$('#aResumeGpt').onclick=()=>{const task=aRead(A_TASK_KEY,null);const words=state.words.filter(w=>task&&task.wordIds.includes(w.id));openAiPackPractice(words);};
};
function aWeakWords(){return state.words.filter(w=>!aPending(w)&&aMeta(w).outputDue&&aMeta(w).outputDue<=Date.now());}
