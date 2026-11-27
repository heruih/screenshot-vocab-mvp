/* ============ 新手引导：首次打开主动播放的分步操作引导 ============
   独立 localStorage key，只记录"已看完"，不碰任何现有数据；可随时跳过。
   触发：persona 身份弹窗选择/跳过之后（见 10i_persona.js 挂接）。 */
const ONBOARDING_KEY='english-notes-onboarding-v1';
const ONBOARDING_STEPS=[
  {
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    title:'截图录入',
    text:'点右下角相机，看剧截图、错题都能录，一次可选多张。'
  },
  {
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg>',
    title:'自动识别',
    text:'图里的英文自动认出来，点你想学的词或句子。'
  },
  {
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    title:'empower 自由整理',
    text:'到笔记页，选中内容就能改、补中文，整理好加入学习。'
  },
  {
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    title:'复习开口',
    text:'先自己说、再看答案，还能进情景对话练着用。'
  }
];
let _obIndex=0,_obEl=null;
function onboardingDone(){try{return localStorage.getItem(ONBOARDING_KEY)==='1';}catch(_){return false;}}
function onboardingFinish(){
  try{localStorage.setItem(ONBOARDING_KEY,'1');}catch(_){}
  if(_obEl)_obEl.classList.remove('show');
}
function onboardingRender(){
  if(!_obEl)return;
  const s=ONBOARDING_STEPS[_obIndex];
  _obEl.querySelector('#obHero').innerHTML=s.icon;
  _obEl.querySelector('#obTitle').textContent=s.title;
  _obEl.querySelector('#obText').textContent=s.text;
  _obEl.querySelector('#obDots').innerHTML=ONBOARDING_STEPS.map((_,i)=>'<span class="ob-dot'+(i===_obIndex?' active':'')+'"></span>').join('');
  _obEl.querySelector('#obBack').style.visibility=_obIndex===0?'hidden':'visible';
  _obEl.querySelector('#obNext').textContent=_obIndex===ONBOARDING_STEPS.length-1?'开始使用':'下一步';
}
function onboardingBuild(){
  const el=document.createElement('div');
  el.className='modal ob-modal';el.id='onboardingModal';
  el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','新手引导');
  el.innerHTML=
    '<div class="ob-card">'+
      '<button class="ob-skip" id="obSkip" type="button">跳过</button>'+
      '<div class="ob-hero" id="obHero"></div>'+
      '<h3 class="ob-title" id="obTitle"></h3>'+
      '<p class="ob-text" id="obText"></p>'+
      '<div class="ob-dots" id="obDots"></div>'+
      '<div class="ob-actions">'+
        '<button class="ob-back" id="obBack" type="button">上一步</button>'+
        '<button class="ob-next" id="obNext" type="button">下一步</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(el);_obEl=el;
  el.querySelector('#obSkip').onclick=onboardingFinish;
  el.querySelector('#obNext').onclick=function(){
    if(_obIndex<ONBOARDING_STEPS.length-1){_obIndex++;onboardingRender();}
    else{onboardingFinish();}
  };
  el.querySelector('#obBack').onclick=function(){if(_obIndex>0){_obIndex--;onboardingRender();}};
}
function onboardingOpen(){
  if(onboardingDone())return;
  if(firstShotCommercial()){
    onboardingFinish();
    if(!state.words.length&&!firstShotState().term)firstShotStart();
    return;
  }
  if(!_obEl)onboardingBuild();
  _obIndex=0;onboardingRender();
  _obEl.classList.add('show');
}
function onboardingInit(){
  if(!_obEl)onboardingBuild();
  const sample=$('#firstShotExample');
  sample.hidden=!firstShotCommercial()||!!firstShotState().done;
  sample.onclick=()=>firstShotExample().catch(()=>toast('示例图读取失败，请重新选择截图','warn'));
}

/* 首次收词进度独立保存；笔记、截图、词条及例句标亮仍使用各自的原有存储。 */
const FIRST_SHOT_KEY='screenshot-vocab-first-shot-v1';
function firstShotCommercial(){return window.APP_CONFIG?.product==='commercial';}
function firstShotState(){
  try{return JSON.parse(localStorage.getItem(FIRST_SHOT_KEY))||{};}catch(_){return {};}
}
function firstShotUpdate(patch){
  if(!aStore(FIRST_SHOT_KEY,JSON.stringify({...firstShotState(),...patch})))throw new Error('收词进度保存失败');
}
function firstShotLine(root,line){
  return Array.from(root.querySelectorAll('[data-shot-line]')).find(el=>el.textContent===line);
}
async function importShotToNote(noteId,terms,dataUrl,getOriginal){
  const note=state.notes.find(n=>n.id===noteId);
  if(!note)throw new Error('请先选择笔记');
  // 先检查并保存图片；空间不足时原图留在导入界面，可重试。
  for(const term of terms){
    if(!await ocrAttachShot(term,dataUrl))throw new Error('截图空间不足');
  }
  if(ui.mode==='edit'&&ui.note===noteId)persistEditor();
  const draft=document.createElement('div');
  draft.innerHTML=note.content||'';
  let guide=firstShotState();
  if(!guide.done&&!state.notes.some(n=>n.id===guide.noteId))guide={};
  let first=null;
  for(const term of terms){
    const original=(getOriginal(term)||'').trim();
    const line=original.toLowerCase().includes(term.toLowerCase())?original:(original?original+'\n':'')+term;
    if(!firstShotLine(draft,line)){
      const block=document.createElement('div');
      block.dataset.shotLine='';block.textContent=line;draft.append(block);
    }
    if(!guide.done&&!guide.term&&term.length<=80&&/^[A-Za-z][A-Za-z'’\- ]*$/.test(term))guide={noteId,term,line,phase:'select'};
    const guided=!guide.done&&guide.noteId===noteId&&qmNorm(term)===qmNorm(guide.term);
    if(!first)first={noteId,line,term};
    if(guided)continue;
    let word=state.words.find(w=>qmNorm(w.term)===qmNorm(term));
    if(!word)word=upsertWord({term,source:'shot'});
    linkWordToNote(word,noteId,note.title);
    if(original&&original!==term&&!word.examples.some(x=>x.en===original))
      word.examples.push({en:original,cn:'',sense:'原文'});
    aPut(word.id,{stage:'learning',original:aMeta(word).original||original});
  }
  note.content=draft.innerHTML;note.updatedAt=Date.now();
  if(ui.mode==='edit'&&ui.note===noteId)bodyEl.innerHTML=note.content;
  save();
  firstShotUpdate({...guide,lastNote:noteId});
  return first;
}
function showImportedNote(result){
  const g=firstShotState();
  const target=(!g.done&&g.term&&state.notes.some(n=>n.id===g.noteId))?g:result;
  openNote(target.noteId);
  firstShotLocate(target);
}
function firstShotLocate(target){
  const block=firstShotLine(bodyEl,target.line);
  if(!block){
    toast('这段原文已编辑。请重新导入截图以继续首次收词。','warn');
    if(firstShotState().noteId===target.noteId&&!firstShotState().done)
      firstShotUpdate({term:'',line:'',marked:'',phase:'select'});
    return;
  }
  block.scrollIntoView({block:'center'});
  // 用临时选区定位，用户仍需自己点 Empower。
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    const pos=node.data.toLowerCase().indexOf(target.term.toLowerCase());
    if(pos<0)continue;
    const range=document.createRange();range.setStart(node,pos);range.setEnd(node,pos+target.term.length);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    checkSelection();break;
  }
}
function firstShotStart(){
  $('#ocrSheet').classList.add('show');ocrShowPanel('import');
}
function firstShotRender(){
  if(!firstShotCommercial())return;
  const g=firstShotState();
  const hint=$('#firstShotNoteHint');
  if(hint)hint.remove();
  if(g.done)return;
  if(ui.mode==='today'){
    $('#firstShotResume')?.remove();
    const button=document.createElement('button');
    button.type='button';button.className='btn';button.id='firstShotResume';
    const resume=g.term&&state.notes.some(n=>n.id===g.noteId);
    button.textContent=resume?'继续首次收词：'+g.term:'用截图收下第一个表达';
    button.onclick=resume?()=>showImportedNote(g):firstShotStart;
    if(resume||!state.words.length)$('#noteList').prepend(button);
  }
  if(ui.mode==='edit'&&ui.note===g.noteId&&g.term){
    const el=document.createElement('button');el.id='firstShotNoteHint';el.className='btn';el.type='button';
    el.textContent='选中 '+g.term+' → Empower → 打开词卡';
    el.onclick=()=>firstShotLocate(g);
    bodyEl.before(el);
  }
}
function firstShotEmpower(note,range){
  const g=firstShotState(), hint=$('#firstShotCardHint');
  if(hint)hint.remove();
  if(!firstShotCommercial()||g.done||!note||note.id!==g.noteId||qmNorm(wmState.term)!==qmNorm(g.term)||!range)return;
  const host=range.commonAncestorContainer;
  const block=(host.nodeType===1?host:host.parentElement).closest('[data-shot-line]');
  if(!block||block.textContent!==g.line)return;
  wmState.firstShot=true;
  const hasSentence=g.line.trim().toLowerCase()!==g.term.trim().toLowerCase();
  // 保持已有例句的索引（标亮按词、例句位置和文本保存）。
  if(hasSentence&&!wmState.examples.some(x=>x.en===g.line)){
    wmState.examples.push({en:g.line,cn:'',sense:'原文'});
  }
  wmState.origSentence=hasSentence?g.line:'';
  renderExCards();aSetStudyMode(false);
  $('#wmTabs [data-wmtab="examples"]')?.click();
  const panel=document.createElement('div');panel.id='firstShotCardHint';panel.className='wm-section';
  const tip=document.createElement('p');
  tip.textContent='点例句里的 '+g.term+'，短语可扩选，再点「标亮」，最后保存表达。';
  panel.append(tip);
  if(!hasSentence){
    const field=document.createElement('textarea');
    field.placeholder='从笔记复制含目标词的完整例句，在这里粘贴，也可以直接输入';
    const add=document.createElement('button');add.className='btn';add.type='button';add.textContent='使用这条例句';
    add.onclick=()=>{
      const en=field.value.trim();
      if(!en||!qmFindRun(qmToks(en),qmToks(g.term))){toast('请粘贴含目标词的例句','warn');return;}
      if(!wmState.examples.some(x=>x.en===en))wmState.examples.push({en,cn:'',sense:'原文'});
      renderExCards();scheduleWmDraft(0);
    };
    panel.append(field,add);
  }
  $('#wmExamples').before(panel);
  firstShotUpdate({phase:'mark'});
}
function firstShotMarked(ctx){
  const g=firstShotState();
  if(!wmState?.firstShot||g.done||qmNorm(ctx.wkey)!==qmNorm(g.term)||qmNorm(ctx.label)!==qmNorm(g.term))return;
  firstShotUpdate({marked:ctx.snap});
  const tip=$('#firstShotCardHint p');if(tip)tip.textContent='已标亮。点「保存表达」完成首次收词。';
}
function firstShotSaved(word){
  const g=firstShotState();
  if(!wmState?.firstShot||g.done||qmNorm(word.term)!==qmNorm(g.term))return;
  const marked=word.examples.some((ex,i)=>ex.en===g.marked&&qmMarks(word.term,i,ex.en).some(m=>qmNorm(m.k)===qmNorm(g.term)));
  if(marked){firstShotUpdate({done:true});$('#firstShotExample').hidden=true;toast('首次收词完成：表达和标亮都已保存','ok');}
  else toast('表达已保存，下次可以继续标亮例句','ok');
}
async function firstShotExample(){
  const sentence='We put off the meeting until Friday.';
  const canvas=document.createElement('canvas');canvas.width=820;canvas.height=180;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,820,180);
  ctx.fillStyle='#222';ctx.font='36px sans-serif';ctx.fillText(sentence,28,100);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve));
  const file=new File([blob],'first-expression.png',{type:'image/png'});
  await ocrImportImage({currentTarget:{files:[file],value:''}});
  if(ocrSourceFile!==file)return;
  $('#ocrEdit').value=sentence;ocrRenderMatchArea($('#ocrSelected'));
  $('#ocrStatus').textContent='试试点 put 和 off，再点「加入已选」。';
}
