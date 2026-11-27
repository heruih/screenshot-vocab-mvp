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
const FIRST_GUIDE_SHOT_STEPS=['sample','newNote','preview','frame','word','pick','shotSave'];
let firstGuideSampleBounds=null;

function firstShotCommercial(){return window.APP_CONFIG?.product==='commercial';}
function firstGuideInProgress(){return firstShotCommercial()&&!!firstGuide.shot&&firstGuide.note!=='done';}
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
  newNote:['#ocrNewNoteFolder,#ocrNewNoteName,#ocrNoteNewBtn','先给练习笔记起个名字，再点「新建」。'],
  preview:['#ocrImgWrap [data-ocr-frame]','点「框选区域」。'],
  frame:['#ocrImageViewport,#ocrRegionApply,#ocrViewerClose','框住整行英文，再点「识别框内」。'],
  word:['#ocrSelected [data-ocr-token="3"]','点截图里的 notice。'],
  pick:['#ocrSelected [data-ocr-add-selected]','点「加入已选」。'],
  shotSave:['#ocrMount','保存这个词。'],
  type:['#noteBody','在正文里输入 empowerment。'],
  select:['#noteBody,#btnKb,#edEmpower','在正文里长按选中 empowerment，再点「做词卡」。电脑上可以拖选。'],
  join:['#btnEmpower','点「加入词库」，打开这张词卡。'],
  mark:['#wmExamples [data-first-example-word],#qdMark,#qdClose','点例句里的 empowerment，再点「标亮」。'],
  colls:['#wmTabs [data-wmtab="colls"]','点一下「核心搭配」。'],
  tags:['#wmTabs [data-wmtab="tags"]','点一下「标签」。'],
  save:['#wmSave','点「保存表达」，回到笔记。']
};
function firstGuideTarget(step){
  firstGuideStep=step;
  if(FIRST_GUIDE_SHOT_STEPS.includes(step)&&step!==firstGuide.shotStep)firstGuideSave({shotStep:step});
  $$('[data-first-guide-target]').forEach(el=>el.removeAttribute('data-first-guide-target'));
  $$('.first-guide-hint').forEach(el=>el.hidden=true);
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
  const target=targets.find(el=>el.getClientRects().length);
  if(target&&!['type','select','frame'].includes(step))target.scrollIntoView({block:'nearest'});
}
function firstGuideBlock(event){
  if(!firstGuideStep||!(event.target instanceof Element))return;
  const [allowed]=FIRST_GUIDE_STEPS[firstGuideStep];
  if(event.type==='keydown'&&event.key==='Tab'){
    const focusable=$$(allowed).filter(el=>el.tabIndex>=0&&!el.disabled&&el.getClientRects().length);
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
  if(target&&event.key!=='Escape'&&!(firstGuideStep==='select'&&target.id==='edEmpower'&&qmNorm(editorSelectedText)!==FIRST_NOTE_TERM))return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function firstGuideBoot(){
  if(!firstShotCommercial())return;
  try{firstGuide=JSON.parse(localStorage.getItem(FIRST_GUIDE_KEY))||{};}catch(_){}
  $('#edEmpower').textContent='做词卡';
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
    if(firstGuideStep==='frame')firstGuideTarget('preview');
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
    if(resume==='frame')ocrOpenImageView($('#ocrSelected'));
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
  if(firstGuideStep!=='frame'||area.id!=='ocrSelected')return null;
  const bounds=firstGuideSampleBounds;
  const includesLine=frame.x<=bounds.left&&frame.y<=bounds.top&&
    frame.x+frame.width>=bounds.right&&frame.y+frame.height>=bounds.bottom;
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
function firstGuideShotSaved(){
  if(firstGuideStep!=='shotSave')return;
  firstGuideSave({shot:'done',shotStep:null});
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
  return !wmState?.firstShot||(firstGuideStep==='mark'&&ctx.snap===FIRST_NOTE_SENTENCE&&qmNorm(ctx.label)===FIRST_NOTE_TERM);
}
function firstShotMarked(){
  if(!wmState?.firstShot||firstGuideStep!=='mark'||!firstGuideHasMark(wmState))return;
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
function firstShotSaved(){
  if(!wmState?.firstShot)return;
  firstGuideSave({note:'done'});
  firstGuideTarget(null);
}
