/* ===== 03_editor.js · 今日复习 / 编辑器 / 大标题折叠 / 赋能词整体化 ===== */
/* ============ 今日复习（间隔重复） ============ */
/* 口语练习是否从复习页发起：完成后接回复习总结，而非停在触发前的页面 */
let aiReturnToReview=false;
function reviewQueue(mode){
  const list=mode==='free'?state.words.slice():dueList();
  list.sort((a,b)=>{
    const da=srsDue(a),db=srsDue(b);
    if(da!==db) return da-db;
    return (a.term||'').localeCompare(b.term||'');
  });
  return list;
}
const REVIEW_ROUND_KEY='english-notes:review-round-v1';
function setReview(mode,round,idx=0){
  /* 从 round 卡片上的 grade 恢复本轮评分结果（刷新/返回续练时不丢推荐依据） */
  const results=(round||[]).filter(c=>c&&c.grade!=null).map(c=>({id:c.id,grade:c.grade}));
  ui.flash={mode,round,ids:round.map(card=>card.id),idx,flipped:false,graded:idx,total:round.length,results};
  return ui.flash;
}
function nextReviewIndex(round,start=0){
  const idx=round.findIndex((card,i)=>i>=start&&state.words.some(w=>w.id===card.id&&!aPending(w)&&(w.srs?.reps||0)<=card.reps));
  return idx<0?round.length:idx;
}
function buildReview(mode='due'){
  if(mode==='free'){
    const round=reviewQueue('free').filter(w=>!aPending(w)).slice(0,10).map(w=>({id:w.id,reps:w.srs?.reps||0}));
    return setReview('free',round);
  }
  /* 默认队列：3 个最早到期且练过的词 + 2 个从未练过的词，某类不足用另一类补齐 */
  const eligible=state.words.filter(w=>!aPending(w)&&isDue(w));
  const picked=buildReviewRound(
    eligible.map(w=>({id:w.id,reps:(w.srs&&w.srs.reps)||0,due:srsDue(w)})),
    {trained:3,fresh:2,max:5}
  );
  const round=picked.map(c=>({id:c.id,reps:c.reps}));
  aStore(REVIEW_ROUND_KEY,JSON.stringify(round));
  return setReview('due',round);
}
function resumeReview(){
  const stored=aRead(REVIEW_ROUND_KEY,null);
  /* 第三阶段队列上限 5：旧版遗留的 25 词轮次(按 due 排序、新词排最前)不再恢复，交给 buildReview 重排成 3 练过 + 2 新 */
  if(Array.isArray(stored)&&stored.length<=5){
    const activeIds=new Set(state.words.filter(w=>!aPending(w)).map(w=>w.id));
    const round=stored.filter(card=>card&&activeIds.has(card.id)&&Number.isInteger(card.reps)&&card.reps>=0);
    // Reconstruct the cursor from the same saved rating that increments reps.
    const idx=nextReviewIndex(round);
    if(idx<round.length) return setReview('due',round,idx);
  }
  return buildReview('due');
}
function flipFlash(){
  if(!ui.flash||!ui.flash.ids.length) return;
  ui.flash.flipped=!ui.flash.flipped;
  renderFlash();
}
function stepFlash(d){
  if(!ui.flash) return;
  const L=ui.flash.ids.length;
  let ni=ui.flash.idx+d;
  if(ni<0) ni=0;
  if(ni>L-1) ni=L-1;
  ui.flash.idx=ni; ui.flash.flipped=false;
  renderFlash();
}
function gradeCurrent(g){
  const f=ui.flash;
  if(!f||!f.ids.length) return;
  const w=state.words.find(x=>x.id===f.ids[f.idx]);
  if(!w) return;
  const before={srs:w.srs&&{...w.srs},mastered:w.mastered,updatedAt:w.updatedAt};
  const s=srsGrade(w,g);
  try{ save(); }
  catch(_){ Object.assign(w,before); return; }
  if(typeof batchReviewRecord==='function')batchReviewRecord(w.id);
  /* 记录本轮评分（写回 round 并持久化，刷新/返回后续练不丢结果、不重复计入） */
  if(f.round[f.idx]) f.round[f.idx].grade=g;
  f.results=(f.results||[]); f.results.push({id:w.id,grade:g});
  try{ aStore(REVIEW_ROUND_KEY,JSON.stringify(f.round)); }catch(_){}
  const tip={0:'已记为「忘了」，10 分钟后再练',1:'记为「有点难」',2:'记为「记住了」'}[g]+' · '+SRS_LABEL[s.box];
  f.idx=nextReviewIndex(f.round,f.idx+1); f.flipped=false; f.graded++;
  renderFlash();
  toast(tip);
}
function renderFlash(){
  $('#paneTitle').textContent=personaIsExam()?'错题重做':'今日复习';
  $('#btnNewNote').style.display='none';
  const box=$('#noteList');
  if(!state.words.length){
    box.innerHTML='<div class="empty-state">'+
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'+
      '<div><b>还没有单词可复习</b><br>回到笔记，选中英文单词点「empower」存入表达库。</div></div>';
    return;
  }
  const sum=srsSummary();
  if(!ui.flash) resumeReview();
  const f=ui.flash;
  const stats='<div class="rv-stats">'+
    '<div class="rv-stat hot"><div class="n">'+sum.due+'</div><div class="l">今日到期</div></div>'+
    '<div class="rv-stat"><div class="n">'+sum.fresh+'</div><div class="l">没练过</div></div>'+
    '<div class="rv-stat ok"><div class="n">'+sum.done+'</div><div class="l">已掌握</div></div>'+
  '</div>';
  if(!f.ids.length||f.idx>=f.ids.length){
    const results=f.results||[];
    const cands=rankSpeakCandidates(results);
    let body;
    if(!f.graded){
      const nxt=state.words.filter(w=>!aPending(w)).sort((a,b)=>srsDue(a)-srsDue(b))[0];
      const nxtTxt=nxt?('下一个到期：'+esc(nxt.term)+'（'+srsNextLabel(nxt)+'）'):'全部单词都已掌握';
      body='<div class="big">🎉</div><b>现在没有到期的单词</b><div style="font-size:13px;color:var(--text2);line-height:1.7">'+nxtTxt+'</div>';
    }else{
      body='<div class="big">🎉</div><b>本轮复习完成 · '+f.graded+' 个词</b>';
      if(cands.length){
        body+='<div class="speak-rec">'+
          '<div class="speak-rec-title">这几个词还没拿稳，建议开口练一下</div>'+
          '<div class="speak-rec-list">'+cands.map(r=>{const ww=state.words.find(x=>x.id===r.id);return ww?'<label class="a-check speak-rec-item"><input type="checkbox" data-speak="'+esc(ww.id)+'" checked>'+esc(ww.term)+' <span class="gtag'+(r.grade===0?' forgot':' hard')+'">'+(r.grade===0?'忘了':'有点难')+'</span></label>':'';}).join('')+'</div>'+
          '<button class="btn primary" id="rvSpeakGo">开始对话</button>'+
        '</div>';
      }else{
        body+='<div style="font-size:13px;color:var(--text2);line-height:1.7">这一轮都记住了，不错。</div>';
      }
    }
    box.innerHTML=stats+
      '<div class="flash-empty">'+body+
        '<div class="rv-actions">'+
          '<button class="btn primary" id="rvHome">结束，回首页</button>'+
          '<button class="btn" id="rvAgain">再练一轮</button>'+
          '<button class="btn" id="rvPickSpeak">去表达库选词开口</button>'+
        '</div>'+
        '<div style="font-size:12px;color:var(--text3)">记忆曲线：1 → 3 → 7 → 15 → 30 天</div>'+
      '</div>';
    const rh=$('#rvHome'); if(rh) rh.addEventListener('click',()=>{ ui.mode='today'; ui.sideOpen=false; render(); });
    const ra=$('#rvAgain'); if(ra) ra.addEventListener('click',()=>{ buildReview('due'); renderFlash(); });
    const rp=$('#rvPickSpeak'); if(rp) rp.addEventListener('click',()=>{ ui.mode='words'; ui.selMode=true; ui.sel=[]; ui.wordFilter='all'; render(); });
    const rg=$('#rvSpeakGo'); if(rg) rg.addEventListener('click',()=>{
      const ids=$$('[data-speak]:checked').map(el=>el.dataset.speak);
      const words=ids.map(id=>state.words.find(w=>w.id===id)).filter(Boolean);
      if(!words.length){ toast('先勾选要练的词','warn'); return; }
      aiReturnToReview=true;
      openAiPackPractice(words);
    });
    return;
  }
  const w=state.words.find(x=>x.id===f.ids[f.idx]);
  if(!w){ f.idx=f.ids.length; renderFlash(); return; }
  const total=f.ids.length;
  const pos=f.idx+1;
  const pct=Math.round((f.idx/total)*100);
  /* 保留原始序号：标亮的存储键是（词, 例句序号, 原文快照），过滤后序号会错位就查不到 */
  const indexedExamples=(w.examples||[]).map((x,oi)=>({x,oi}));
  const examples=indexedExamples.filter(o=>o.x.sense!=='原文');
  const s=w.srs||{box:1,due:0};
  const origEx=indexedExamples.find(o=>o.x.sense==='原文');
  const srcN=w.notes&&w.notes[0]?(state.notes.find(x=>x.id===w.notes[0].noteId)||null):null;
  const shots=(w?shotsGet(w.term):[]).slice(0,4);
  /* 方案 A：复习卡背面只读配图缓存，绝不发起网络请求（不会卡顿、不会超时） */
  const picRec=wmImgCached(w.term);
  const picCand=(picRec&&Array.isArray(picRec.cands)&&picRec.cands.length)?picRec.cands[Math.min(picRec.idx||0,picRec.cands.length-1)]:null;
  const picUrl=picCand?(picCand.thumb||picCand.src||''):'';
  const shot0=shots.length?shots[0].dataUrl:'';
  let fbMedia='';
  if(picUrl&&shot0){
    fbMedia='<div class="fb-stack" data-fbstack>'+
      '<div class="fb-card fb-card-shot" data-fbflip><img src="'+esc(shot0)+'" alt="截图" data-fbshot="0" loading="lazy"></div>'+
      '<div class="fb-card fb-card-pic" data-fbflip><img src="'+esc(picUrl)+'" alt="配图" data-fbpic="1" loading="lazy" referrerpolicy="no-referrer"></div>'+
    '</div>';
  }else if(picUrl){
    fbMedia='<div class="fb-stack single"><div class="fb-card fb-card-pic"><img src="'+esc(picUrl)+'" alt="配图" data-fbpic="1" loading="lazy" referrerpolicy="no-referrer"></div></div>';
  }else if(shot0){
    fbMedia='<div class="fb-stack single"><div class="fb-card fb-card-shot"><img src="'+esc(shot0)+'" alt="截图" data-fbshot="0" loading="lazy"></div></div>';
  }
  const backFace=
    '<div class="flash-face flash-back">'+
      (w.phonetic?'<div class="fb-phon">'+esc(w.phonetic)+'</div>':'')+
      '<div class="fb-def">'+esc(w.definition||'（暂无释义）')+'</div>'+
      (w.collocations&&w.collocations.length?'<div class="fb-coll">'+w.collocations.map(c=>'<span class="coll-chip">'+esc(c)+'</span>').join('')+'</div>':'')+
      (origEx?'<div class="fb-orig">原句：'+qwHTML(origEx.x.en,w.term,w.term,origEx.oi)+'</div>':'')+
      fbMedia+
      (examples.length?'<div class="fb-ex">'+examples.map((o,i)=>{const x=o.x;return '<div class="fb-ex-item"><div class="fb-ex-row"><div class="e" data-fbcn="'+i+'">“'+qwHTML(x.en,w.term,w.term,o.oi)+'”</div>'+speakBtn(x.en)+'</div>'+(x.cn?'<div class="c hided"><span class="cn-real">'+esc(x.cn)+'</span><span class="cn-tip">点这一行看中文</span></div>':'')+'</div>';}).join('')+'</div>':(origEx?'<div class="fb-tagline">原文句已在上方</div>':'<div class="fb-tagline">这个词还没有例句</div>'))+
      '<div class="fb-tagline">第 '+s.box+' 箱 · '+(s.due<=Date.now()?'今天到期':srsNextLabel(w))+'</div>'+
      (srcN?'<div class="fb-src">来自笔记：'+esc(srcN.title||'')+'</div>':'')+
    '</div>';
  const dueMode=f.mode!=='free';
  const causeMode=dueMode&&personaIsExam();   /* 考试派错题重做才显示错因标记 */
  const selCauses=causeMode?errorCauseGet(w.id):[];
  const reviewGuide='<div class="review-guide"><div class="review-guide-copy"><span class="review-guide-kicker">今日复习</span><b>'+(dueMode?'到期复习':'自由复习')+'</b><small>先回想，再点卡片翻开</small></div><strong>'+f.graded+' / '+total+'</strong></div>';
  box.innerHTML='<div class="rv-wrap">'+stats+
    reviewGuide+
    '<div class="rv-bar"><i style="width:'+pct+'%"></i></div>'+
    '<div class="flash-wrap">'+
      '<div class="flash-progress">'+(dueMode?'待复习':'自由复习')+'　'+pos+' / '+total+'</div>'+
      '<div class="flash-scene"><div class="flash-card'+(f.flipped?' flipped':'')+'" id="flashCard">'+
        '<div class="flash-face flash-front"><div class="flash-term-row"><div class="flash-term">'+esc(w.term)+'</div>'+speakBtn(w.term,'','word')+
          '<button class="speak-btn follow-btn" data-wordfollow="'+esc(w.term)+'" aria-label="跟读这个单词"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/></svg></button>'+
        '</div>'+(w.followBest?'<div class="flash-best">跟读最佳 '+w.followBest+' 分</div>':'')+'<div class="flash-hint">点击卡片看释义'+(w.examples&&w.examples.length?'和例句':'')+'</div></div>'+
        backFace+
      '</div></div>'+
      (dueMode?
        (f.flipped?
          (causeMode?'<div class="cause-row">'+
            '<div class="cause-row-title">错在哪（可多选·可不填）</div>'+
            '<div class="cause-chips">'+
              ERROR_CAUSES.map(c=>'<button type="button" class="cause-chip'+(selCauses.indexOf(c.id)>=0?' active':'')+'" data-cause="'+c.id+'">'+c.label+'</button>').join('')+
            '</div>'+
          '</div>':'')+
          '<div class="grade-row">'+
          '<button class="grade-btn again" data-grade="0">忘了<small>10 分钟后再练</small></button>'+
          '<button class="grade-btn hard" data-grade="1">有点难<small>缩短间隔</small></button>'+
          '<button class="grade-btn good" data-grade="2">记住了<small>拉长间隔</small></button>'+
        '</div>':'<div class="flash-hint-row">先回想，再点卡片翻开</div>')+
      '<div class="review-exit-row"><button class="btn" id="reviewExit" type="button">结束复习，返回首页</button></div>'
        :'<div class="flash-actions">'+
          '<button class="btn" id="flashPrev"'+(f.idx===0?' disabled':'')+'>上一张</button>'+
          '<button class="btn" id="flashNext"'+(f.idx===total-1?' disabled':'')+'>下一张</button>'+
          '<button class="btn" id="flashExit">回到今日复习</button>'+
        '</div>')+
    '</div>'+
  '</div>';
  const card=$('#flashCard');
  card.addEventListener('click',flipFlash);
  $$('#flashCard [data-wordfollow]').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();
    openFollow(b.getAttribute('data-wordfollow'),b.getAttribute('data-wordfollow'),'');
  }));
  $$('#flashCard [data-play]').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();
    if(b.getAttribute('data-play-kind')==='word') speakWord(b.getAttribute('data-play'));
    else speak(b.getAttribute('data-play'),b.getAttribute('data-play-lang')||'en-US');
  }));
  /* 叠放卡片：点下层露出边角先交换，点当前在上的主图执行原动作；左滑也可交换 */
  const fbStack=$('#flashCard [data-fbstack]');
  if(fbStack){
    let fbLastFlip=0;
    const doFlip=()=>{fbStack.classList.toggle('flipped');fbLastFlip=Date.now();};
    let sx=0,sy=0;
    fbStack.addEventListener('touchstart',e=>{const p=e.touches[0];sx=p.clientX;sy=p.clientY;},{passive:true});
    fbStack.addEventListener('touchend',e=>{
      const p=e.changedTouches[0],dx=p.clientX-sx,dy=p.clientY-sy;
      if(Math.abs(dx)<45||Math.abs(dx)<Math.abs(dy)*1.2)return;
      if(fbStack.classList.contains('single'))return;
      e.stopPropagation();doFlip();
    },{passive:true});
    fbStack.addEventListener('click',e=>{
      if(Date.now()-fbLastFlip<450)return;            /* 触摸滑动后的合成 click 忽略 */
      const shotEl=e.target.closest('[data-fbshot]');
      const picEl=e.target.closest('[data-fbpic]');
      if(!shotEl&&!picEl)return;
      e.stopPropagation();
      const isSingle=fbStack.classList.contains('single');
      const flipped=fbStack.classList.contains('flipped');
      if(shotEl){
        if(!isSingle&&!flipped){doFlip();return;}
        openShotViewerFor(w.term,0);
      }else{
        if(!isSingle&&flipped){doFlip();return;}
        openWordModal(w.term,null,null,w);
      }
    });
  }
  $$('#flashCard [data-fbcn]').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();            /* 别让卡片跟着翻回去 */
    const it=el.closest('.fb-ex-item');
    const c=it&&it.querySelector('.c');
    if(c) c.classList.toggle('hided');
  }));
  /* 中文那一行自己也能点开/收起 */
  $$('#flashCard .fb-ex-item .c').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    el.classList.toggle('hided');
  }));
  $$('.cause-chip').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();            /* 不触发卡片翻回 */
    errorCauseToggle(w.id,b.dataset.cause);
    renderFlash();
  }));
  $$('.grade-btn').forEach(b=>b.addEventListener('click',()=>gradeCurrent(Number(b.dataset.grade))));
  const rex=$('#reviewExit');if(rex)rex.addEventListener('click',()=>{ ui.mode='today'; ui.sideOpen=false; render(); });
  const pv=$('#flashPrev'), nx=$('#flashNext'), ex=$('#flashExit');
  if(pv) pv.addEventListener('click',()=>stepFlash(-1));
  if(nx) nx.addEventListener('click',()=>stepFlash(1));
  if(ex) ex.addEventListener('click',()=>{ resumeReview(); renderFlash(); });
}

/* ============ 编辑器 ============ */
const titleEl=$('#noteTitle'), bodyEl=$('#noteBody'), editorWrap=$('#editorWrap');
function renderEditor(){
  const n=state.notes.find(x=>x.id===ui.note);
  if(!n||ui.mode!=='edit'){ editorWrap.classList.add('hidden'); closeNoteOrganize(); resetEditorBar(); return; }
  editorWrap.classList.remove('hidden');
  if(ui.lastNote!==ui.note){
    resetEditorBar();
    titleEl.innerText=(n.title==='无标题')?'':n.title;
    bodyEl.innerHTML=n.content||'';
    ui.lastNote=ui.note;
    applyFolds();
    lockWords();
    const h=$('#edHint'); if(h) h.classList.remove('out');
  }
  updatePlaceholders();
  syncEdHint();
  syncEditorBar();
  if(typeof updateNoteInboxBar==='function')updateNoteInboxBar();
}
function noteLinkedWords(noteId){
  return state.words.filter(w=>Array.isArray(w.notes)&&w.notes.some(x=>x&&x.noteId===noteId));
}
function closeNoteOrganize(){
  const panel=$('#noteOrganize');
  if(!panel)return;
  panel.classList.remove('show');
  panel.setAttribute('aria-hidden','true');
}
function openNoteOrganize(){
  const panel=$('#noteOrganize'),summary=$('#noteOrganizeSummary'),list=$('#noteOrganizeWords');
  const n=state.notes.find(x=>x.id===ui.note);
  if(!panel||!n)return;
  persistEditor();
  const words=noteLinkedWords(n.id);
  if(summary)summary.textContent=words.length?'这篇笔记已关联 '+words.length+' 个表达。点词条可直接查看，完整整理仍在表达库中进行。':'这篇笔记暂时还没有关联表达。选中文字后点 empower，就能加入表达库。';
  if(list){
    list.innerHTML=words.length?words.map(w=>'<button class="note-organize-word" type="button" data-note-organize-word="'+esc(w.id)+'"><span>'+esc(w.term)+'</span><small>'+esc((w.definition||'待补释义').split('\n')[0])+'</small></button>').join(''):'<div class="note-organize-empty">还没有关联表达</div>';
  }
  panel.classList.add('show');
  panel.setAttribute('aria-hidden','false');
}

/* 首次新建笔记时的一行提示：用够 3 次就不再出现，输入第一个字就收起 */
const HINT_KEY='english-notes-hint-v1';
function hintShown(){ try{ return +(localStorage.getItem(HINT_KEY)||0)||0; }catch(_){ return 9; } }
function hintBump(){ try{ localStorage.setItem(HINT_KEY,String(Math.min(9,hintShown()+1))); }catch(_){ } }
let hintTimer=0;
function syncEdHint(){
  const el=$('#edHint');
  if(!el) return;
  const empty=!bodyEl.textContent.trim()&&!titleEl.textContent.trim();
  if(ui.mode!=='edit'||!empty||hintShown()>=3){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden','out');
  clearTimeout(hintTimer);
  hintTimer=setTimeout(()=>{ hideEdHint(false); },7000);
}
function hideEdHint(countIt){
  const el=$('#edHint');
  if(!el||el.classList.contains('hidden')) return;
  el.classList.add('out');
  clearTimeout(hintTimer);
  setTimeout(()=>el.classList.add('hidden'),500);
  if(countIt) hintBump();
}
function updatePlaceholders(){
  titleEl.classList.toggle('empty',!titleEl.textContent.trim());
  bodyEl.classList.toggle('empty',!bodyEl.textContent.trim());
}
let saveTimer=null;
/* ============ 编辑历史栈（内存，限 20 步，覆盖输入/移动/粘贴/跨笔记操作） ============ */
const HIST_MAX=20;
let histStack=[];
let histLastInput=0;
function histSnapshot(){
  return {noteId:ui.note, title:titleEl.innerText.trim()||'无标题', content:bodyCleanHTML()};
}
/* 压入一个「可回到的过去状态」；与栈顶相同不重复压，超长度丢最旧 */
function histPush(clipboardChange=null,affectedWords=[]){
  const snap=histSnapshot();
  const words=[...new Set(affectedWords)];
  snap.links=words.map(word=>{
    const index=(word.notes||[]).findIndex(link=>link.noteId===snap.noteId);
    return {wordId:word.id,index,link:index<0?null:{...word.notes[index]}};
  });
  snap.clipboardChange=clipboardChange;
  const top=histStack[histStack.length-1];
  if(!clipboardChange&&!words.length&&top&&top.noteId===snap.noteId&&top.title===snap.title&&top.content===snap.content)return;
  histStack.push(snap);
  if(histStack.length>HIST_MAX)histStack.shift();
  histSyncUndoBtn();
}
/* 离散操作（移动/粘贴/剪切/折叠）前调用；连续输入由 onEditorInput 按时间节流 */
function histArmInput(){
  const now=Date.now();
  if(now-histLastInput>1200)histPush();
  histLastInput=now;
}
function histSyncUndoBtn(){
  const b=$('#btnHistUndo');
  if(!b)return;
  b.classList.toggle('disabled',!histStack.length);
  b.disabled=!histStack.length;
}
function histUndo(){
  if(!histStack.length){toast('没有可撤销的操作');return;}
  const snap=histStack.pop();
  if(!state.notes.some(note=>note.id===snap.noteId)){
    histSyncUndoBtn();editorUndoFeedback('');toast('原笔记已不存在，无法撤销这一步','warn');return;
  }
  /* 快照属于另一篇笔记：先切过去（openNote 已不再清空历史），再恢复那篇的状态 */
  if(snap.noteId&&snap.noteId!==ui.note){
    try{ openNote(snap.noteId); }catch(_){ }
  }
  resetEditorBar();
  titleEl.innerText=snap.title;
  bodyEl.innerHTML=snap.content;
  for(const {wordId,index,link} of snap.links||[]){
    const word=state.words.find(item=>item.id===wordId);
    if(!word) continue;
    const notes=(word.notes||[]).filter(item=>item.noteId!==snap.noteId);
    if(link) notes.splice(index,0,link);
    word.notes=notes;
  }
  const change=snap.clipboardChange;
  let clipboardRestored=true;
  if(change&&JSON.stringify(clipGet())===JSON.stringify(change.after)){
    clipboardRestored=change.before?clipSet(change.before):clipClear();
  }
  try{ lockWords(bodyEl); }catch(_){ }
  try{ mvDecorate(); }catch(_){ }
  try{ applyFolds(); }catch(_){ }
  try{ persistEditor(); }catch(_){ }
  histSyncUndoBtn();
  try{ if(navigator.vibrate)navigator.vibrate(8); }catch(_){}
  toast(clipboardRestored?'已撤销':'正文已撤销，剪贴板恢复失败',clipboardRestored?'ok':'warn');
}
function onEditorInput(){
  try{ histArmInput(); }catch(_){ }
  try{ healWords(); }catch(_){ }
  try{ autoHeading(); }catch(_){ }
  try{ hideEdHint(true); }catch(_){ }
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{ persistEditor(); renderSidebar(); renderPane(); },400);
}
function persistEditor(){
  const n=state.notes.find(x=>x.id===ui.note);
  if(!n) return;
  n.title=titleEl.innerText.trim()||'无标题';
  n.content=bodyCleanHTML();
  n.sel=captureCaret();
  n.updatedAt=Date.now();
  updatePlaceholders();
  save();
}
/* 记忆输入位置：像备忘录一样，随时退出、下次进入还在原处 */
function captureCaret(){
  const el=bodyEl, s=window.getSelection();
  if(!s||s.rangeCount===0||!el.contains(s.anchorNode)) return null;
  const r=s.getRangeAt(0);
  let node=r.startContainer, path=[];
  while(node&&node!==el){
    const parent=node.parentNode;
    if(!parent) break;
    const idx=Array.prototype.indexOf.call(parent.childNodes,node);
    if(idx<0) break;
    path.unshift({i:idx,e:node.nodeType===1});
    node=parent;
  }
  if(node!==el) return null;
  return {path,off:r.startOffset};
}
function restoreCaret(sel){
  if(!sel){ focusEnd(bodyEl); return; }
  try{
    let node=bodyEl;
    for(const p of sel.path){
      const kids=node.childNodes;
      node=(p.i<kids.length)?kids[p.i]:null;
      if(!node){ node=null; break; }
    }
    if(!node){ focusEnd(bodyEl); return; }
    const r=document.createRange();
    if(node.nodeType===3) r.setStart(node,Math.min(sel.off||0,node.length));
    else r.setStart(node,Math.min(sel.off||0,node.childNodes.length));
    r.collapse(true);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
    bodyEl.focus();
  }catch(_){ focusEnd(bodyEl); }
}
function focusEnd(el){
  el.focus();
  try{
    const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }catch(_){}
}
/* ============ 正文大标题 + 点一下收起（备忘录那套） ============ */
const FOLD_KEY='english-notes-fold-v1';
function foldAll(){
  try{ const o=JSON.parse(localStorage.getItem(FOLD_KEY)||'{}'); return (o&&typeof o==='object'&&!Array.isArray(o))?o:{}; }catch(_){ return {}; }
}
function foldOf(id){
  const a=foldAll()[id];
  return (a&&typeof a==='object'&&!Array.isArray(a))?a:{};
}
function foldSet(id,idx,on){
  if(!id) return;
  const all=foldAll();
  const m=Object.assign({},all[id]||{});
  if(on) m[idx]=1; else delete m[idx];
  if(Object.keys(m).length) all[id]=m; else delete all[id];
  try{ localStorage.setItem(FOLD_KEY,JSON.stringify(all)); }catch(_){ }
}
function isHead(el){ return !!(el&&el.nodeType===1&&el.classList&&el.classList.contains('nh')); }
function blockAtCaret(){
  const s=window.getSelection();
  if(!s||!s.rangeCount) return null;
  let n=s.anchorNode;
  if(!n) return null;
  if(n.nodeType===3) n=n.parentNode;
  while(n&&n!==bodyEl&&n.parentNode!==bodyEl) n=n.parentNode;
  return (n&&n!==bodyEl&&n.parentNode===bodyEl)?n:null;
}
function caretTo(el){
  try{
    const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
    bodyEl.focus();
  }catch(_){ }
}
function caretAtStart(el){
  const s=window.getSelection();
  if(!s||!s.rangeCount) return false;
  const r=s.getRangeAt(0);
  if(!r.collapsed||!el.contains(r.startContainer)) return false;
  const pre=document.createRange();
  pre.selectNodeContents(el);
  try{ pre.setEnd(r.startContainer,r.startOffset); }catch(_){ return false; }
  return pre.toString().length===0;
}
function headingIdx(h){
  let i=-1;
  for(const el of bodyEl.children){ if(isHead(el)) i++; if(el===h) return i; }
  return -1;
}
/* 把「折叠」画出来：只加视图用的 class，保存时会清掉 */
function applyFolds(){
  if(!bodyEl||!ui.note) return;
  const folded=foldOf(ui.note);
  let hi=-1, hide=false;
  Array.prototype.forEach.call(bodyEl.children,el=>{
    el.classList.remove('nh-fold');
    if(isHead(el)){
      hi++;
      hide=!!folded[hi];
      el.classList.toggle('folded',hide);
      return;
    }
    if(hide) el.classList.add('nh-fold');
  });
  try{ mvDecorate(); }catch(_){ }
}
function toggleFold(h,force){
  if(!h||!ui.note) return;
  const idx=headingIdx(h);
  if(idx<0) return;
  const next=(force===undefined)?!h.classList.contains('folded'):!!force;
  foldSet(ui.note,idx,next);
  applyFolds();
  try{ if(navigator.vibrate) navigator.vibrate(8); }catch(_){ }
}
/* 光标如果落在被收起的段落里，把那一节展开，免得看不见自己在哪 */
function revealCaret(){
  const b=blockAtCaret();
  if(!b||!b.classList.contains('nh-fold')) return;
  let p=b.previousElementSibling;
  while(p&&!isHead(p)) p=p.previousElementSibling;
  if(p) toggleFold(p,false);
}
/* 保存出去的正文：把只给界面看的 class 摘掉，内容一个字不改 */
function bodyCleanHTML(){
  const c=bodyEl.cloneNode(true);
  c.querySelectorAll('.mf,.mv-drop').forEach(e=>e.remove());
  c.querySelectorAll('.nh-fold').forEach(e=>e.classList.remove('nh-fold'));
  c.querySelectorAll('.folded').forEach(e=>e.classList.remove('folded'));
  c.querySelectorAll('.mv-pick').forEach(e=>e.classList.remove('mv-pick'));
  c.querySelectorAll('.en-word').forEach(e=>{
    e.removeAttribute('contenteditable');
    e.removeAttribute('spellcheck');
    e.classList.remove('mv-lift','sel-pick');
    if(!e.getAttribute('class')) e.removeAttribute('class');
  });
  c.querySelectorAll('.mv-hit').forEach(e=>e.classList.remove('mv-hit'));
  c.querySelectorAll('[style=""]').forEach(e=>e.removeAttribute('style'));
  c.querySelectorAll('[class=""]').forEach(e=>e.removeAttribute('class'));
  /* 局部字体：去掉用于占位的零宽空格，解包没有实际内容的空字体壳 */
  c.querySelectorAll('.tf-serif,.tf-rounded,.tf-mono').forEach(e=>{
    if(e.innerHTML.indexOf('​')>=0) e.innerHTML=e.innerHTML.split('​').join('');
    if(!e.textContent && !e.querySelector('img,.en-word')){ while(e.firstChild) e.parentNode.insertBefore(e.firstChild,e); e.remove(); }
  });
  c.querySelectorAll('[class=""]').forEach(e=>e.removeAttribute('class'));
  return c.innerHTML;
}

/* ============ 赋能词 = 一个整体：光标进不去，也改不了字母 ============ */
/* 用系统级的 contenteditable="false" 做原子块；再留一层自愈，防粘贴/输入法把字改掉 */
const wSnap=new WeakMap();
function wOK(s,t){ return s.childElementCount===0 && s.textContent===t; }
function wFix(s,t){ if(t!=null&&!wOK(s,t)) s.textContent=t; }
function lockWords(root){
  const b=root||bodyEl;
  if(!b||!b.querySelectorAll) return;
  const list=b.classList&&b.classList.contains('en-word')?[b]:Array.prototype.slice.call(b.querySelectorAll('.en-word'));
  list.forEach(s=>{
    if(!wSnap.has(s)) wSnap.set(s,s.textContent);
    else wFix(s,wSnap.get(s));
    if(s.getAttribute('contenteditable')!=='false') s.setAttribute('contenteditable','false');
    if(s.getAttribute('spellcheck')!=='false') s.setAttribute('spellcheck','false');
  });
}
/* 万一词里的字变了（粘贴、输入法、撤销），立刻还原成一个整体 */
function healWords(){
  if(!bodyEl) return 0;
  let n=0;
  bodyEl.querySelectorAll('.en-word').forEach(s=>{
    const t=wSnap.get(s);
    if(t!=null&&!wOK(s,t)){ s.textContent=t; n++; }
    if(s.getAttribute('contenteditable')!=='false') s.setAttribute('contenteditable','false');
  });
  return n;
}
/* 行首输入 # 空格 → 这一行变大标题 */
function autoHeading(){
  const b=blockAtCaret();
  if(!b||isHead(b)) return false;
  const t=b.textContent||'';
  const m=t.match(/^#{1,4}\s(.*)$/);
  if(!m) return false;
  const rest=(m[1]||'').replace(/\s+$/,'');
  b.classList.add('nh');
  b.textContent=rest;
  if(!rest) b.appendChild(document.createElement('br'));
  caretTo(b);
  return true;
}


