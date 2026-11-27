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
    if(!firstGuide.shot&&!state.words.length)firstGuideStart();
    return;
  }
  if(!_obEl)onboardingBuild();
  _obIndex=0;onboardingRender();
  _obEl.classList.add('show');
}
function onboardingInit(){
  if(!_obEl)onboardingBuild();
  firstGuideBoot();
}

/* 教程进度单独保存。截图、笔记、词卡和标亮沿用原本的数据。 */
const FIRST_SHOT_KEY='screenshot-vocab-first-shot-v1';
const FIRST_GUIDE_KEY='screenshot-vocab-first-guide-v2';
const FIRST_SHOT_TERM='notice';
const FIRST_SHOT_SENTENCE='We notice small changes.';
const FIRST_NOTE_TERM='empowerment';
const FIRST_NOTE_SENTENCE='Education can lead to empowerment.';
let firstGuide={};
let firstGuideStep=null;
const FIRST_GUIDE_SHOT_STEPS=['sample','newNote','noteCreate','preview','frame','frameApply','word','pick','shotSave'];
let firstGuideSampleBounds=null;

function firstShotCommercial(){return window.APP_CONFIG?.product==='commercial';}
function firstGuideInProgress(){return firstShotCommercial()&&!!firstGuide.shot&&(firstGuide.note!=='done'||ui.flash?.mode==='first');}
function firstShotState(){
  try{return JSON.parse(localStorage.getItem(FIRST_SHOT_KEY))||{};}catch(_){return {};}
}
function firstGuideSave(patch){
  firstGuide={...firstGuide,...patch};
  if(!aStore(FIRST_GUIDE_KEY,JSON.stringify(firstGuide)))toast('引导进度没能保存，刷新后可能需要重试','warn');
}

async function importShotToNote(noteId,terms,dataUrl,getOriginal){
  const note=state.notes.find(n=>n.id===noteId);
  if(!note)throw new Error('请先选择笔记');
  for(const term of terms){
    if(!await ocrAttachShot(term,dataUrl))throw new Error('截图空间不足');
  }
  if(ui.mode==='edit'&&ui.note===noteId)persistEditor();
  const draft=document.createElement('div');
  draft.innerHTML=note.content||'';
  const lines=new Set(Array.from(draft.querySelectorAll('[data-shot-line]'),el=>el.textContent));
  let first=null;
  for(const term of terms){
    const original=(getOriginal(term)||'').trim();
    const line=original.toLowerCase().includes(term.toLowerCase())?original:(original?original+'\n':'')+term;
    if(!lines.has(line)){
      const block=document.createElement('div');
      block.dataset.shotLine='';block.textContent=line;draft.append(block);
      lines.add(line);
    }
    let word=state.words.find(w=>qmNorm(w.term)===qmNorm(term));
    if(!word)word=upsertWord({term,source:'shot'});
    linkWordToNote(word,noteId,note.title);
    if(original&&original!==term&&!word.examples.some(x=>x.en===original))
      word.examples.push({en:original,cn:'',sense:'原文'});
    if(aPending(word))aPut(word.id,{stage:'learning',original:aMeta(word).original||original});
    else if(!aMeta(word).original&&original)aPut(word.id,{original});
    if(!first)first={noteId,word};
  }
  note.content=draft.innerHTML;note.updatedAt=Date.now();
  if(ui.mode==='edit'&&ui.note===noteId)bodyEl.innerHTML=note.content;
  save();
  firstGuideSave({lastNote:noteId});
  return first;
}

function showImportedNote(result){if(result)openNote(result.noteId);}

const FIRST_GUIDE_STEPS={
  sample:['#firstShotExample','用示例截图练习一次。'],
  newNote:['#ocrNewNoteName','给练习笔记起个名字。'],
  noteCreate:['#ocrNoteNewBtn,#ocrNewNoteName','点「新建」，继续导入。'],
  preview:['#ocrImgWrap [data-ocr-frame]','点「框选区域」。'],
  frame:['#ocrImageViewport,#ocrViewerClose','拖动框住整行英文。'],
  frameApply:['#ocrRegionApply,#ocrImageViewport,#ocrViewerClose','点「识别框内」。'],
  word:['#ocrSelected [data-ocr-token="3"]','点截图里的 notice。'],
  pick:['#ocrSelected [data-ocr-add-selected]','点「加入已选」。'],
  shotSave:['#ocrMount','保存这个词。'],
  type:['#noteBody','在正文里输入 empowerment。'],
  select:['#noteBody,#btnKb,#edEmpower','在正文里长按选中 empowerment，再点「做词卡」。电脑上可以拖选。'],
  join:['#btnEmpower','点「加入词库」，打开这张词卡。'],
  mark:['#wmExamples [data-first-example-word]','点例句里的 empowerment。'],
  markApply:['#qdMark,#qdClose','点「标亮」。'],
  colls:['#wmTabs [data-wmtab="colls"]','点一下「核心搭配」。'],
  tags:['#wmTabs [data-wmtab="tags"]','点一下「标签」。'],
  save:['#wmSave','点「保存表达」，回到笔记。'],
  firstFlip:['#flashCard','先想想这个词的意思，再翻卡。'],
  firstRate:['.grade-row','按真实记忆情况选一档。'],
  firstChoose:['#firstReviewWord,#firstReviewLater','从刚复习的 5 个词里选一个。'],
  firstSpeak:['#firstReviewSpeak,#firstReviewWord,#firstReviewLater','点「开始 AI 对话」，用一个词说一句。'],
  firstAiWait:['#aiClose','正在准备或批改，完成后继续。'],
  firstAiRetry:['#aiRetry,#aiGotoSettings,#aiClose','可以重试，或返回后稍后再练。'],
  firstAiInput:['#aiChatbar,#aiClose','开口说，或输入一句含目标词的英文。'],
  firstAiSend:['#aiSend,#aiInput,#aiMic,#aiClose','点「提交答案」，看看 AI 的反馈。'],
  firstAiDone:['#aiClose2,#aiClose','看完反馈后点「完成」，回到复习。'],
  firstEnd:['#firstReviewEndActions','首次练习完成。可以结束，也可以继续复习。']
};
function firstGuideTarget(step){
  firstGuideStep=step;
  if(FIRST_GUIDE_SHOT_STEPS.includes(step)&&step!==firstGuide.shotStep)firstGuideSave({shotStep:step});
  $$('[data-first-guide-target]').forEach(el=>el.removeAttribute('data-first-guide-target'));
  $$('.first-guide-hint').forEach(el=>el.hidden=true);
  firstGuidePaint();
  if(!step)return;
  coachClose();
  const [selector,message]=FIRST_GUIDE_STEPS[step];
  const targets=$$(selector);
  targets.forEach(el=>el.setAttribute('data-first-guide-target',''));
  const hint=$('#ocrImageViewer').open?'#firstGuideFrameHint':
    $('#ocrSheet').classList.contains('show')?'#firstGuideShotHint':
    $('#wordModal').classList.contains('show')?'#firstGuideCardHint':'#firstGuideNoteHint';
  const box=$(hint);
  box.textContent=message;
  box.hidden=false;
  const target=selector.split(',').map(part=>$(part)).find(el=>el?.getClientRects().length);
  if(target&&!['type','select','frame'].includes(step))target.scrollIntoView({block:'nearest'});
}
function firstGuideBlock(event){
  if(!firstGuideStep||!(event.target instanceof Element))return;
  const [allowed]=FIRST_GUIDE_STEPS[firstGuideStep];
  if(event.type==='keydown'&&event.key==='Tab'){
    const focusable=$$('button,input,select,textarea,[tabindex],[contenteditable]').filter(el=>
      el.closest(allowed)&&el.tabIndex>=0&&!el.disabled&&el.getClientRects().length);
    if(focusable.length){
      const index=focusable.indexOf(document.activeElement);
      const next=index<0?(event.shiftKey?focusable.length-1:0):
        (index+(event.shiftKey?-1:1)+focusable.length)%focusable.length;
      focusable[next].focus();
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  const target=event.target.closest(allowed);
  if(firstGuideStep==='firstFlip'&&event.target.closest('#flashCard button')){
    event.preventDefault();event.stopImmediatePropagation();return;
  }
  if(target&&event.key!=='Escape'&&!(firstGuideStep==='select'&&target.id==='edEmpower'&&qmNorm(editorSelectedText)!==FIRST_NOTE_TERM))return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function firstGuideBoot(){
  if(!firstShotCommercial())return;
  try{firstGuide=JSON.parse(localStorage.getItem(FIRST_GUIDE_KEY))||{};}catch(_){}
  firstReviewState=aRead(FIRST_REVIEW_KEY,{});
  firstGuideInitSpotlight();
  $('#aiInput').addEventListener('input',()=>firstReviewAiStatus('practice'));
  $('#edEmpower').textContent='做词卡';
  $('#ocrNewNoteName').addEventListener('input',event=>{
    if(['newNote','noteCreate'].includes(firstGuideStep)){
      firstGuideTarget(event.target.value.trim()?'noteCreate':'newNote');
    }
  });
  $('#firstShotExample').onclick=()=>firstShotExample();
  for(const type of ['click','pointerdown','keydown','beforeinput']){
    document.addEventListener(type,firstGuideBlock,true);
  }
  bodyEl.addEventListener('input',()=>{
    if(!['type','select'].includes(firstGuideStep))return;
    const step=/\bempowerment\b/i.test(bodyEl.textContent)?'select':'type';
    if(step===firstGuideStep)return;
    persistEditor();
    firstGuideSave({note:step});
    firstGuideTarget(step);
  });
  $('#ocrImageViewer').addEventListener('close',()=>{
    if(['frame','frameApply'].includes(firstGuideStep))firstGuideTarget('preview');
  });
  setTimeout(()=>{
    if($('#personaModal').classList.contains('show'))return;
    if(firstGuide.shot==='pending')firstGuideStart(firstGuide.shotStep);
    else if(firstGuide.shot==='done'&&firstGuide.note&&firstGuide.note!=='done')firstShotNotes();
    else if(!firstGuide.shot&&!state.words.length&&onboardingDone())firstGuideStart();
  },0);
}
function firstGuideStart(resume='sample'){
  firstGuideSave({shot:'pending'});
  $('#ocrSheet').classList.add('show');ocrShowPanel('import');
  $('#firstShotExample').hidden=false;
  $('#firstShotExample').disabled=false;
  firstGuideTarget('sample');
  if(resume!=='sample')firstShotExample(resume);
}
async function firstShotExample(resume='sample'){
  const sample=$('#firstShotExample');
  if(firstGuideStep!=='sample'||sample.disabled)return;
  sample.disabled=true;
  try{
    await firstGuideLoadSample();
    if(['frame','frameApply'].includes(resume))ocrOpenImageView($('#ocrSelected'));
    if(['word','pick','shotSave'].includes(resume)){
      const area=$('#ocrSelected');
      firstGuideFrameRead(area,FIRST_SHOT_SENTENCE);
      if(resume==='word')return;
      const word=$('#ocrSelected [data-ocr-token="3"]');
      ocrPickToken(area,word);
      firstGuideTarget('pick');
      if(resume==='shotSave'){
        ocrAddSelectedTerm(area);
        firstGuideTarget('shotSave');
      }
    }
  }catch(_){
    ocrShowPanel('import');firstGuideStart();toast('示例图读取失败，请重试','warn');
  }
}
async function firstGuideLoadSample(){
  const canvas=document.createElement('canvas');
  canvas.width=720;canvas.height=240;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,720,240);
  ctx.font='40px sans-serif';
  const width=ctx.measureText(FIRST_SHOT_SENTENCE).width;
  firstGuideSampleBounds={left:84/720,top:104/240,right:(76+width)/720,bottom:128/240};
  ctx.fillStyle='#edf5ff';ctx.fillRect(64,78,width+32,78);
  ctx.fillStyle='#192538';ctx.fillText(FIRST_SHOT_SENTENCE,80,130);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve));
  if(!blob)throw new Error('示例截图无法生成');
  const file=new File([blob],'first-screenshot.png',{type:'image/png'});
  await ocrImportImage({currentTarget:{files:[file],value:''}},true);
}
function firstGuidePickNote(){
  const note=state.notes.find(n=>n.id===firstGuide.shotNoteId);
  if(note)return note.id;
  const picked=pickNoteForImport({
    created(noteId){firstGuideSave({shotNoteId:noteId});}
  });
  firstGuideTarget('newNote');
  return picked;
}
function firstGuidePreview(){
  $('#firstShotExample').hidden=true;
  firstGuideTarget('preview');
}
function firstGuideFrameOpened(){
  if(firstGuideStep==='preview')firstGuideTarget('frame');
}
function firstGuideFrameText(area,frame){
  if(!['frame','frameApply'].includes(firstGuideStep)||area.id!=='ocrSelected')return null;
  const includesLine=firstGuideFrameContainsLine(frame);
  if(!includesLine)firstGuideTarget('frame');
  if(!includesLine)$('#ocrViewerHint').textContent='请把整行英文框进去，再点「识别框内」。';
  return includesLine?FIRST_SHOT_SENTENCE:'';
}
function firstGuideFrameRead(area,text){
  area.querySelector('[data-ocr-text]').value=text;
  ocrRenderMatchArea(area);
  $('#ocrStatus').textContent='';
  firstGuideTarget('word');
}
function firstGuideOcrPicked(button){
  if(firstGuideStep==='word'&&button.dataset.ocrToken==='3')firstGuideTarget('pick');
  if(firstGuideStep==='pick'&&button.hasAttribute('data-ocr-add-selected')&&
    ocrMatchTargets($('#ocrSelected')).includes(FIRST_SHOT_TERM))firstGuideTarget('shotSave');
}
function firstGuideShotSaved(word){
  if(firstGuideStep!=='shotSave')return;
  firstGuideSave({shot:'done',shotStep:null,sampleIds:word?[...(firstGuide.sampleIds||[]),word.id]:[]});
  firstGuideTarget(null);
}
function firstShotNotes(){
  if(firstGuide.shot!=='done'||firstGuide.note==='done')return false;
  let note=state.notes.find(n=>n.id===firstGuide.shotNoteId);
  if(note)openNote(note.id);
  else{
    newNote();
    note=state.notes.find(n=>n.id===ui.note);
    firstGuideSave({shotNoteId:note.id,note:'type'});
  }
  const step=firstGuide.note||'type';
  if(['mark','colls','tags','save'].includes(step))firstGuideOpenCard(note,null);
  else{
    firstGuideSave({note:step});
    firstGuideTarget(step);
    if(step==='type'){
      const paragraph=document.createElement('div');
      paragraph.append(document.createElement('br'));
      bodyEl.append(paragraph);
      bodyEl.focus();
      focusEnd(paragraph);
    }
  }
  return true;
}
function firstGuideJoin(){
  if(firstGuideStep!=='select')return;
  firstGuideTarget('join');
}
function firstGuideOpenCard(note,range){
  if(!note||note.id!==firstGuide.shotNoteId)return;
  const existing=state.words.find(w=>qmNorm(w.term)===FIRST_NOTE_TERM)||null;
  const examples=(existing?.examples||[]).slice();
  if(!examples.some(x=>x.en===FIRST_NOTE_SENTENCE))
    examples.push({en:FIRST_NOTE_SENTENCE,cn:'教育可以让人获得自主权。',sense:'示例'});
  openWordModal(FIRST_NOTE_TERM,{id:note.id,title:note.title},range,existing,null,{
    examples,tags:existing?.tags||[],collocations:existing?.collocations||[],
    definition:existing?.definition||'赋权，让人拥有自主权',mastered:!!existing?.mastered
  });
  wmState.origSentence='';
  wmState.firstShot=true;
  aSetStudyMode(false);
  const selected=$$('#wmExamples .qw').find(el=>qmNorm(el.textContent)===FIRST_NOTE_TERM&&
    wmState.examples[Number(el.closest('[data-excn]')?.dataset.excn)]?.en===FIRST_NOTE_SENTENCE);
  if(selected)selected.setAttribute('data-first-example-word','');
  const step=['colls','tags','save'].includes(firstGuide.note)&&firstGuideHasMark(wmState)?firstGuide.note:'mark';
  setWordModalTab({tags:'colls',save:'tags'}[step]||'examples');
  firstGuideSave({note:step});
  firstGuideTarget(step);
}
function firstGuideHasMark(card){
  return card.examples.some((ex,i)=>ex.en===FIRST_NOTE_SENTENCE&&
    qmMarks(card.term,i,ex.en).some(m=>qmNorm(m.k)===FIRST_NOTE_TERM));
}
function firstGuideCanMark(ctx){
  return !wmState?.firstShot||(firstGuideStep==='markApply'&&ctx.snap===FIRST_NOTE_SENTENCE&&qmNorm(ctx.label)===FIRST_NOTE_TERM);
}
function firstShotMarked(){
  if(!wmState?.firstShot||firstGuideStep!=='markApply'||!firstGuideHasMark(wmState))return;
  firstGuideSave({note:'colls'});
  firstGuideTarget('colls');
}
function firstGuideTabClicked(tab){
  const next=firstGuideStep==='colls'&&tab==='colls'?'tags':
    firstGuideStep==='tags'&&tab==='tags'?'save':null;
  if(!next)return;
  firstGuideSave({note:next});
  firstGuideTarget(next);
}
function firstGuideCanSave(){
  if(!wmState.firstShot)return true;
  if(firstGuideStep==='save'&&firstGuideHasMark(wmState))return true;
  toast('先完成词卡引导，再保存表达。','warn');
  return false;
}
function firstShotSaved(word){
  if(!wmState?.firstShot)return;
  firstGuideSave({note:'done',sampleIds:[...new Set([...(firstGuide.sampleIds||[]),word.id])]});
  firstGuideTarget(null);
}

let firstGuideSpotlight,firstGuideFrameRequest;
function firstGuidePaint(){
  if(firstGuideFrameRequest)return;
  firstGuideFrameRequest=requestAnimationFrame(()=>{
    firstGuideFrameRequest=0;
    const step=firstGuideStep;
    let target=step?FIRST_GUIDE_STEPS[step][0].split(',').map(part=>$(part)).find(el=>el?.getClientRects().length):null;
    let message=step?FIRST_GUIDE_STEPS[step][1]:'';
    if(step==='select'&&qmNorm(editorSelectedText)===FIRST_NOTE_TERM&&$('#edEmpower').getClientRects().length){
      target=$('#edEmpower');message='点「做词卡」。';
    }
    const dialog=$('#ocrImageViewer');
    const root=dialog.open?dialog:document.body;
    if(root!==firstGuideSpotlight.parentNode)root.append(firstGuideSpotlight);
    const r=target?.getBoundingClientRect(),v=window.visualViewport;
    const contextSelector={firstRate:'#flashCard .fb-def',firstAiInput:'#aiScene',firstAiSend:'#aiScene',firstAiDone:'#aiScene'}[step];
    const context=contextSelector?$(contextSelector)?.getBoundingClientRect():null;
    const left=v?.offsetLeft||0,top=v?.offsetTop||0;
    const right=left+(v?.width||innerWidth),bottom=top+(v?.height||innerHeight);
    const contextVisible=context&&context.height>0&&context.bottom>top&&context.top<bottom;
    const x=r?Math.max(left,Math.min(r.left,contextVisible?context.left:r.left)-2):0;
    const y=r?Math.max(top,Math.min(r.top,contextVisible?context.top:r.top)-2):0;
    const w=r?Math.min(right,Math.max(r.right,contextVisible?context.right:r.right)+2)-x:0;
    const h=r?Math.min(bottom,Math.max(r.bottom,contextVisible?context.bottom:r.bottom)+2)-y:0;
    firstGuideSpotlight.hidden=!r||w<=4||h<=4||!target.getClientRects().length;
    if(firstGuideSpotlight.hidden)return;
    const hole=firstGuideSpotlight.firstElementChild,tip=hole.nextElementSibling;
    Object.assign(hole.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
    tip.lastElementChild.textContent=message;
    const tipWidth=Math.min(250,Math.max(110,right-left-18));
    tip.style.width=tipWidth+'px';
    const anchorTop=Math.max(top,r.top),anchorBottom=Math.min(bottom,r.bottom);
    const below=anchorBottom+11+tip.offsetHeight<bottom-8;
    tip.firstElementChild.textContent=below?'↑':'↓';
    const center=(Math.max(left,r.left)+Math.min(right,r.right))/2;
    const tipLeft=Math.max(left+8,Math.min(right-tipWidth-8,center-tipWidth/2));
    tip.style.setProperty('--guide-arrow-x',Math.max(10,Math.min(tipWidth-10,center-tipLeft))+'px');
    tip.dataset.below=String(below);
    Object.assign(tip.style,{left:tipLeft+'px',top:(below?anchorBottom+12:Math.max(top+9,anchorTop-tip.offsetHeight-12))+'px'});
  });
}
function firstGuideInitSpotlight(){
  firstGuideSpotlight=document.createElement('div');
  firstGuideSpotlight.className='first-guide-spotlight';
  firstGuideSpotlight.hidden=true;
  firstGuideSpotlight.setAttribute('aria-hidden','true');
  firstGuideSpotlight.innerHTML='<div class="first-guide-opening"></div><div class="first-guide-caption"><span></span><span></span></div>';
  document.body.append(firstGuideSpotlight);
  document.addEventListener('scroll',firstGuidePaint,{capture:true,passive:true});
  window.addEventListener('resize',firstGuidePaint);
  window.visualViewport?.addEventListener('resize',firstGuidePaint);
  window.visualViewport?.addEventListener('scroll',firstGuidePaint);
}
function firstGuideFrameContainsLine(frame){
  const b=firstGuideSampleBounds;
  return frame&&b&&frame.x<=b.left&&frame.y<=b.top&&
    frame.x+frame.width>=b.right&&frame.y+frame.height>=b.bottom;
}
function firstGuideFrameChanged(frame){
  if(!['frame','frameApply'].includes(firstGuideStep))return;
  const step=firstGuideFrameContainsLine(frame)?'frameApply':'frame';
  if(step!==firstGuideStep)firstGuideTarget(step);
}
function firstGuideQuickDict(open){
  if(open&&firstGuideStep==='mark')firstGuideTarget('markApply');
  if(!open&&firstGuideStep==='markApply')firstGuideTarget('mark');
}

/* 首轮复习状态与日常复习分开。评分仍走原有的卡片调度。 */
const FIRST_REVIEW_KEY='screenshot-vocab-first-review-v1';
const FIRST_REVIEW_SIZE=5;
let firstReviewState={},firstReviewTimer=0,firstReviewPaused=false,firstReviewDialogActive=false;
function firstReviewSave(patch){
  const updated={...firstReviewState,...patch};
  if(!aStore(FIRST_REVIEW_KEY,JSON.stringify(updated))){
    toast('首轮复习进度没有保存，请检查存储空间','warn');return false;
  }
  firstReviewState=updated;
  return true;
}
function firstReviewWords(){
  const sampleIds=new Set(firstGuide.sampleIds||[]);
  return state.words.filter(w=>!aPending(w)&&!sampleIds.has(w.id)&&!(
    w.notes?.some(n=>n.noteId===firstGuide.shotNoteId)&&w.examples?.some(ex=>
      (w.term===FIRST_SHOT_TERM&&ex.en===FIRST_SHOT_SENTENCE)||
      (w.term===FIRST_NOTE_TERM&&ex.sense==='示例'&&ex.en===FIRST_NOTE_SENTENCE))
  ));
}
function firstReviewMaybe(){
  if(!firstShotCommercial()||firstGuide.note!=='done'||firstReviewState.phase==='done'||
    firstReviewPaused||firstGuideStep||firstReviewTimer)return;
  firstReviewTimer=setTimeout(()=>{
    firstReviewTimer=0;
    if(firstGuideStep||firstReviewPaused||document.querySelector('.modal.show,.ai-page.show,dialog[open]'))return;
    firstReviewStart();
  },0);
}
function firstReviewStart(){
  if(!firstShotCommercial()||firstGuide.note!=='done'||firstReviewState.phase==='done')return false;
  const words=firstReviewWords();
  let round=firstReviewState.round;
  if(!Array.isArray(round)||round.some(card=>!words.some(w=>w.id===card.id))){
    if(words.length<FIRST_REVIEW_SIZE)return false;
    round=words.slice(0,FIRST_REVIEW_SIZE).map(w=>({id:w.id,reps:w.srs?.reps||0}));
    if(!firstReviewSave({round,phase:'cards',choice:''}))return false;
  }
  if(ui.mode==='edit')persistEditor();
  firstReviewPaused=false;
  ui.mode='flash';ui.note=null;ui.sideOpen=false;
  setReview('first',round,nextReviewIndex(round));
  render();
  return true;
}
function firstReviewRenderCard(f){
  if(f.mode==='first')firstGuideTarget(f.flipped?'firstRate':'firstFlip');
}
function firstReviewRenderSummary(box,stats,f){
  const words=f.ids.map(id=>state.words.find(w=>w.id===id)).filter(Boolean);
  if(firstReviewState.phase==='feedback'){
    box.innerHTML=stats+'<div class="flash-empty"><b>首次复习和对话完成</b>'+
      '<div class="rv-actions" id="firstReviewEndActions"><button class="btn primary" id="firstReviewEnd">结束，回首页</button><button class="btn" id="firstReviewContinue">继续复习</button></div></div>';
    $('#firstReviewEnd').onclick=()=>firstReviewFinish(false);
    $('#firstReviewContinue').onclick=()=>firstReviewFinish(true);
    firstGuideTarget('firstEnd');
    return;
  }
  const difficult=rankSpeakCandidates(f.results);
  const picked=words.find(w=>w.id===firstReviewState.choice)||words.find(w=>w.id===difficult[0]?.id);
  const message=difficult.length?'选一个词开口练，推荐词已选好。':'这轮都记住了。挑一个你想用的词说一句。';
  box.innerHTML=stats+'<div class="flash-empty"><b>首轮复习完成 · '+f.graded+' 个词</b>'+
    '<p>'+esc(message)+'</p><div class="rv-actions" id="firstReviewActions">'+
    (difficult.length===1?'<b>'+esc(picked.term)+'</b>':
      '<select id="firstReviewWord" aria-label="选择一个词做 AI 对话"><option value="">选一个词</option>'+
      words.map(w=>'<option value="'+esc(w.id)+'"'+(picked?.id===w.id?' selected':'')+'>'+esc(w.term)+'</option>').join('')+'</select>')+
    '<button class="btn primary" id="firstReviewSpeak"'+(picked?'':' disabled')+'>开始 AI 对话</button>'+
    '</div><button class="btn" id="firstReviewLater">稍后再练</button></div>';
  const select=$('#firstReviewWord');
  if(select)select.onchange=()=>{
    firstReviewSave({choice:select.value});
    $('#firstReviewSpeak').disabled=!select.value;
    firstGuideTarget(select.value?'firstSpeak':'firstChoose');
  };
  $('#firstReviewSpeak').onclick=()=>{
    const word=select?words.find(w=>w.id===select.value):picked;
    if(!word)return;
    if(!firstReviewSave({choice:word.id,phase:'dialogue'}))return;
    firstReviewDialogActive=true;
    openAiPractice(word.term);
  };
  $('#firstReviewLater').onclick=()=>{
    firstReviewPaused=true;
    firstGuideTarget(null);
    ui.mode='today';ui.flash=null;render();
  };
  firstGuideTarget(picked?'firstSpeak':'firstChoose');
}
function firstReviewFinish(continueReview){
  if(!firstReviewSave({phase:'done'}))return;
  firstGuideTarget(null);
  ui.mode=continueReview?'flash':'today';ui.flash=null;
  render();
}
function firstReviewAiStatus(phase){
  if(!firstReviewDialogActive)return;
  if(phase==='practice'){
    firstGuideTarget($('#aiInput').value.trim()?'firstAiSend':'firstAiInput');
  }else if(phase==='review'&&firstReviewState.phase==='feedback'){
    firstGuideTarget('firstAiDone');
  }else if(phase==='loading'){
    firstGuideTarget('firstAiWait');
  }else{
    firstGuideTarget('firstAiRetry');
  }
}
function firstReviewFeedback(){
  if(!firstReviewDialogActive)return;
  if(firstReviewSave({phase:'feedback'}))firstReviewAiStatus('review');
}
function firstReviewAiClosed(){
  if(!firstReviewDialogActive)return false;
  firstReviewDialogActive=false;
  firstGuideTarget(null);
  if(ui.mode==='flash'&&ui.flash?.mode==='first')renderFlash();
  return true;
}
