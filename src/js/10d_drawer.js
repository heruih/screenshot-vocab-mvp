/* ============ 手机端表达库：筛选收进底部抽屉（桌面端不触发） ============ */
const WF_SELECTORS=['.a-tools','.word-filter','.wb-bar'];
function wfNodes(){return WF_SELECTORS.map(s=>document.querySelector('#noteList '+s)).filter(Boolean);}
function wfSummary(){
  const fLabel={all:'全部',due:'待复习',today:'今日新增',todo:'未掌握',done:'已掌握',noex:'缺例句',pending:'待整理'};
  const sLabel={created:'最近添加',alpha:'字母顺序',due:'到期时间'};
  const parts=[fLabel[ui.wordFilter]||'全部'];
  if(ui.wordTag)parts.push('#'+ui.wordTag);
  if(ui.wordNote){
    const nt=state.notes.find(n=>n.id===ui.wordNote);
    parts.push(nt?(nt.title||'无标题'):'全部笔记');
  }
  if(ui.wordDate)parts.push(ui.wordDate);
  if(ui.wordSort&&ui.wordSort!=='time')parts.push(sLabel[ui.wordSort]||ui.wordSort);
  return parts.join(' · ');
}
function wfShow(){
  const mask=$('#wordFilterMask'),sheet=$('#wordFilterSheet');
  mask.hidden=false;sheet.hidden=false;
  requestAnimationFrame(()=>{mask.classList.add('show');sheet.classList.add('show');});
}
function wfHide(){
  const mask=$('#wordFilterMask'),sheet=$('#wordFilterSheet');
  mask.classList.remove('show');sheet.classList.remove('show');
  setTimeout(()=>{mask.hidden=true;sheet.hidden=true;},260);
}
function wfOpenSheet(){
  const nodes=wfNodes();
  if(!nodes.length)return;
  const body=$('#wordFilterBody');
  nodes.forEach(n=>body.appendChild(n));   // 移动 DOM，事件监听器保留
  ui.wordFilterOpen=true;
  wfShow();
}
function wfCloseSheet(){
  ui.wordFilterOpen=false;
  const body=$('#wordFilterBody');
  const grid=document.querySelector('#noteList .words-grid')||document.querySelector('#noteList .empty-state');
  const rank=n=>{const i=WF_SELECTORS.findIndex(s=>n.matches(s));return i<0?99:i;};
  [...body.children].sort((a,b)=>rank(a)-rank(b)).forEach(n=>{
    if(grid)grid.parentNode.insertBefore(n,grid);else $('#noteList').appendChild(n);
  });
  wfHide();
}
function wfSync(){
  const trig=$('#wordFilterTrigger');
  if(ui.mode!=='words'){
    trig.hidden=true;
    if(ui.wordFilterOpen){ui.wordFilterOpen=false;$('#wordFilterBody').innerHTML='';wfHide();}
    return;
  }
  const nodes=wfNodes();
  if(!nodes.length){trig.hidden=true;return;}   // 空表达库，无筛选可显示
  trig.hidden=false;
  $('#wordFilterSummary').textContent=wfSummary();
  if(ui.wordFilterOpen){
    const body=$('#wordFilterBody');body.innerHTML='';
    nodes.forEach(n=>body.appendChild(n));
    wfShow();
  }
}
/* ============ 手机端首页：练习入口收进折叠区（桌面端默认展开、不显示折叠头） ============ */
function pfWrap(){
  const list=$('#noteList');
  if(!list)return;
  const targets=[];
  const batch=list.querySelector('.a-batch-entry');
  if(batch)targets.push(batch);
  const actions=list.querySelector('.today-actions');
  if(actions)targets.push(actions);
  /* 每天一小轮卡片：含 #bAudioOpen 的 a-callout */
  const smallRound=[...list.querySelectorAll('.a-callout')].find(c=>c.querySelector('#bAudioOpen'));
  if(smallRound)targets.push(smallRound);
  /* 工具按钮组、说明文字也一并收进折叠区，保持首页干净 */
  list.querySelectorAll('.a-tools').forEach(el=>targets.push(el));
  list.querySelectorAll('.a-note').forEach(el=>targets.push(el));
  if(!targets.length)return;
  const head=document.createElement('button');
  head.type='button';head.className='practice-fold-head';head.id='practiceFoldHead';
  head.setAttribute('aria-expanded','false');
  head.innerHTML='<span class="pfh-label">练习</span><span class="pfh-caret"></span>';
  const pbody=document.createElement('div');
  pbody.className='practice-fold-body';pbody.id='practiceFoldBody';
  const anchor=targets[0];
  list.insertBefore(head,anchor);
  list.insertBefore(pbody,anchor);
  targets.forEach(el=>pbody.appendChild(el));   // 移动 DOM，事件监听器保留
  head.onclick=()=>{
    const open=pbody.classList.toggle('open');
    head.classList.toggle('open',open);
    head.setAttribute('aria-expanded',open?'true':'false');
  };
}
function aSelectedWords(){return filteredWords().filter(w=>!aPending(w)&&(!ui.selMode||!ui.sel.length||ui.sel.includes(w.id)));}
function aNewWord(){showConfirm({title:'添加完整表达',msg:'',okText:'继续整理',onOk(){const t=$('#aNewTerm').value.trim();if(!t)return;let w=state.words.find(x=>x.term.toLowerCase()===t.toLowerCase());if(!w){w=upsertWord({term:t,source:'manual'});aPut(w.id,{stage:'pending'});save();}openWordModal(w.term,null,null,w);}});$('#cfMsg').innerHTML='<label for="aNewTerm">输入单词或完整短语</label><input id="aNewTerm" class="wm-coll-input" placeholder="例如 I am not really into it" autocomplete="off">';$('#aNewTerm').focus();}
const aOriginalCard=wordCardHTML;
wordCardHTML=function(w){return '<div class="a-word-wrap"><div class="a-word-status">'+(aPending(w)?'待整理':aOutputLabel(w))+'</div>'+aOriginalCard(w)+'</div>';};
function aOutputLabel(w){const n=aData.attempts.filter(x=>x.wordId===w.id&&x.result==='independent').length;return n?'独立用出 '+n+' 次':'已入库 · 等待实际使用';}
