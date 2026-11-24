/* ===== 04_move.js · 移动词与整节 / 笔记与文件夹增删 / 键盘 ===== */
/* ============ 移动：词 / 整节（拿起 → 放下） ============ */
const mvState={kind:'',node:null,nodes:[],title:'',revert:null,focus:-1};
let mvTimer=0;
function headList(){ return Array.prototype.filter.call(bodyEl.children,isHead); }
function sectionEnd(head){
  let n=head.nextElementSibling,last=head;
  while(n&&!isHead(n)){ last=n; n=n.nextElementSibling; }
  return last;
}
function secGroup(head){
  const end=sectionEnd(head); const g=[]; let n=head;
  while(n){ g.push(n); if(n===end) break; n=n.nextElementSibling; }
  return g;
}
function foldClear(){
  if(!ui.note) return;
  const all=foldAll(); delete all[ui.note];
  try{ localStorage.setItem(FOLD_KEY,JSON.stringify(all)); }catch(_){ }
}
/* 大标题的「⋯」入口已移除（整节操作改由长按标题触发，与系统操作一致）；保留空函数供各处调用 */
function mvDecorate(){
  return;
}
function mvClearTargets(){
  if(!bodyEl) return;
  Array.prototype.forEach.call(bodyEl.querySelectorAll('.mv-drop'),e=>e.remove());
  Array.prototype.forEach.call(bodyEl.querySelectorAll('.nh.mv-pick'),e=>{ e.classList.remove('mv-pick'); });
  Array.prototype.forEach.call(bodyEl.querySelectorAll('.nh.mv-here'),e=>{ e.classList.remove('mv-here'); });
  document.body.classList.remove('mv-lift');
}
function mvPaintTargets(){
  mvClearTargets();
  if(!mvState.kind) return;
  headList().forEach((h,i)=>{
    const b=document.createElement('span');
    b.className='mv-drop'; b.setAttribute('contenteditable','false');
    b.setAttribute('data-hi',String(i));
    if(mvState.kind==='section') b.setAttribute('data-kind','sec');
    h.appendChild(b);
    h.classList.add('mv-pick');
  });
  document.body.classList.add('mv-lift');
}
/* 底部浮条实际有多高，提示气泡就抬多高（浮条两行时也不会压住） */
function syncLift(){
  const bars=[$('#mvBar'),$('#undoBar')].filter(b=>b&&b.classList.contains('show'));
  const h=bars.length?Math.max.apply(null,bars.map(b=>b.offsetHeight||0)):0;
  try{
    if(h) document.body.style.setProperty('--lift',(h+16)+'px');
    else document.body.style.removeProperty('--lift');
  }catch(_){ }
}
function mvBarShow(txt,opt){
  const bar=$('#mvBar'); if(!bar) return;
  $('#mvTxt').textContent=txt||'';
  $('#mvEnd').classList.toggle('hidden',!(opt&&opt.end));
  $('#mvUndo').classList.toggle('hidden',!(opt&&opt.undo));
  $('#mvCancel').classList.toggle('hidden',!!(opt&&opt.undo));
  const jump=!!(opt&&opt.jump);
  $('#mvPrev').classList.toggle('hidden',!jump);
  $('#mvNext').classList.toggle('hidden',!jump);
  bar.classList.toggle('jumping',jump);
  bar.classList.add('show');
  document.body.classList.add('mv-bar');
  syncLift();
}
function mvBarHide(){
  const b=$('#mvBar'); if(b) b.classList.remove('show');
  document.body.classList.remove('mv-bar');
  syncLift();
}
function mvReset(){
  clearTimeout(mvTimer);
  mvState.kind=''; mvState.node=null; mvState.nodes=[]; mvState.title=''; mvState.revert=null; mvState.focus=-1;
  mvClearTargets(); mvBarHide();
}
/* 这个词/这一节现在落在第几节（不在任何标题下就是 -1） */
function mvSecIndex(node){
  const hs=headList();
  if(!node) return -1;
  for(let i=0;i<hs.length;i++){
    if(node===hs[i]) return i;
    if(secGroup(hs[i]).indexOf(node)>=0) return i;
  }
  return -1;
}
/* 拿起后点「上一节 / 下一节」：滚到那一节并高亮，不用自己翻 */
function mvJump(dir){
  const hs=headList();
  if(!hs.length){ toast('这篇还没有大标题：行首输入 # 加空格就能建一个','warn'); return; }
  if(typeof mvState.focus!=='number') mvState.focus=-1;
  let i=mvState.focus+dir;
  if(i<0) i=0;
  if(i>hs.length-1) i=hs.length-1;
  mvState.focus=i;
  const h=hs[i];
  hs.forEach(x=>x.classList.remove('mv-here'));
  h.classList.add('mv-here');
  try{ h.scrollIntoView({block:'center',behavior:'smooth'}); }catch(_){ try{ h.scrollIntoView(); }catch(__){ } }
  toast('第 '+(i+1)+'/'+hs.length+' 节 · '+((h.textContent||'').trim().slice(0,12)||''));
  try{ if(navigator.vibrate) navigator.vibrate(8); }catch(_){ }
}
function mvFail(msg){
  mvReset();
  toast(msg?(msg+'，原样留在原地'):'没移动成功，东西还在原地','warn');
}
function mvLiftWord(span){
  if(!span||!bodyEl||!bodyEl.contains(span)){ toast('这个词不在正文里','warn'); return false; }
  mvReset();
  mvState.kind='word'; mvState.node=span; mvState.title=(span.textContent||'').trim();
  mvDecorate(); mvPaintTargets();
  mvState.focus=mvSecIndex(span);
  mvBarShow('已拿起 '+mvState.title,{end:true,jump:true});
  try{ closeWordModal(); }catch(_){ }
  try{ if(navigator.vibrate) navigator.vibrate(10); }catch(_){ }
  if(!headList().length) toast('这篇还没有大标题：行首输入 # 加空格就能建一个','warn');
  return true;
}
function mvLiftSection(h){
  if(!h||!bodyEl||!bodyEl.contains(h)) return false;
  mvReset();
  const g=secGroup(h);
  mvState.kind='section'; mvState.nodes=g; mvState.title=(h.textContent||'').trim().slice(0,26)||'这一节';
  mvDecorate(); mvPaintTargets();
  mvState.focus=mvSecIndex(h);
  mvBarShow('已拿起「'+mvState.title+'」',{jump:true});
  try{ if(navigator.vibrate) navigator.vibrate(10); }catch(_){ }
  return true;
}
function mvDoneBar(label,revert){
  mvState.kind=''; mvState.node=null;
  mvClearTargets(); mvDecorate(); applyFolds(); persistEditor();
  mvState.revert=revert||null;
  mvBarShow(label,{undo:true});
  clearTimeout(mvTimer);
  mvTimer=setTimeout(()=>{ mvBarHide(); mvState.revert=null; },6000);
  try{ if(navigator.vibrate) navigator.vibrate(8); }catch(_){ }
}
/* 把拿起的词放进去：target 是大标题（放在这一节末尾），传 null 就是文末 */
function mvDropWord(target){
  histPush();
  const node=mvState.node;
  if(!node||!bodyEl.contains(node)) return mvFail('原词不见了');
  const div=document.createElement('div');
  div.appendChild(node.cloneNode(true));
  const anchor=target?sectionEnd(target):null;
  try{ if(anchor) anchor.parentNode.insertBefore(div,anchor.nextSibling); else bodyEl.appendChild(div); }
  catch(_){ return mvFail(); }
  if(!bodyEl.contains(div)) return mvFail();
  const oldBlock=node.parentElement;
  const oldNext=oldBlock?oldBlock.nextElementSibling:null;
  const nodeNext=node.nextSibling;
  const keep=!!(oldBlock&&oldBlock===bodyEl)||!!(oldBlock&&(oldBlock.textContent.trim()||oldBlock.querySelector('.en-word')));
  const label='已移动 '+((node.textContent||'').trim());
  node.remove();
  if(!keep&&oldBlock&&oldBlock!==bodyEl) oldBlock.remove();
  lockWords(div);
  if(target){
    const idx=headingIdx(target);
    if(idx>=0&&foldOf(ui.note)[idx]) foldSet(ui.note,idx,false);
  }
  mvDoneBar(label,()=>{
    try{
      if(!keep&&oldBlock&&bodyEl!==oldBlock&&!bodyEl.contains(oldBlock)){
        if(oldNext&&bodyEl.contains(oldNext)) bodyEl.insertBefore(oldBlock,oldNext);
        else bodyEl.appendChild(oldBlock);
      }
      if(oldBlock){
        /* 放回原来那一句里的原位置，别甩到行尾 */
        if(nodeNext&&oldBlock.contains(nodeNext)) oldBlock.insertBefore(node,nodeNext);
        else oldBlock.appendChild(node);
      }
      div.remove(); applyFolds(); mvDecorate(); persistEditor();
    }catch(_){ }
  });
  return true;
}
function mvDropSection(target){
  histPush();
  const g=mvState.nodes;
  if(!g||!g.length) return mvFail();
  if(!target) return mvFail('整节只能放到某个大标题下面');
  if(g.indexOf(target)>=0) return mvFail('不能放进自己这一节');
  const anchor=sectionEnd(target);
  const originNext=g[g.length-1].nextSibling;
  /* 先插一个占位，再搬整节；这样「目标和源挨着」时插入点也不会失效 */
  const mark=document.createComment('mvmark');
  try{ anchor.parentNode.insertBefore(mark,anchor.nextSibling); }catch(_){ return mvFail(); }
  const frag=document.createDocumentFragment();
  g.forEach(el=>frag.appendChild(el));
  try{ mark.parentNode.insertBefore(frag,mark); mark.remove(); }
  catch(_){ try{ mark.remove(); }catch(e2){ } return mvFail(); }
  if(!bodyEl.contains(g[0])) return mvFail();
  foldClear();
  const title=mvState.title;
  mvDoneBar('已移动「'+title+'」',()=>{
    try{
      const f2=document.createDocumentFragment(); g.forEach(el=>f2.appendChild(el));
      if(originNext&&bodyEl.contains(originNext)) bodyEl.insertBefore(f2,originNext);
      else bodyEl.appendChild(f2);
      foldClear(); applyFolds(); mvDecorate(); persistEditor();
    }catch(_){ }
  });
  return true;
}
/* 「⋯」里的上移 / 下移一节 */
function mvMoveSection(h,dir){
  if(!h||!bodyEl.contains(h)) return false;
  histPush();
  const g=secGroup(h);
  if(dir<0){
    const prev=h.previousElementSibling;
    if(!prev){ toast('已经是第一节了'); return false; }
    let s=prev;
    while(s&&!isHead(s)) s=s.previousElementSibling;
    /* 前面只有普通段落、没有别的大标题：那就是第一节，别把它顶到文章最前面 */
    if(!s){ toast('已经是第一节了'); return false; }
    const frag=document.createDocumentFragment(); g.forEach(el=>frag.appendChild(el));
    bodyEl.insertBefore(frag,s);
  }else{
    const next=sectionEnd(h).nextElementSibling;
    if(!next){ toast('已经是最后一节了'); return false; }
    const tEnd=sectionEnd(next);
    const frag=document.createDocumentFragment(); g.forEach(el=>frag.appendChild(el));
    tEnd.parentNode.insertBefore(frag,tEnd.nextSibling);
  }
  foldClear(); applyFolds(); mvDecorate(); persistEditor();
  toast(dir<0?'已上移一节':'已下移一节');
  return true;
}
/* 在正文里找某个单词的那一块 */
function mvFindSpan(term,wid){
  if(!bodyEl) return null;
  const list=Array.prototype.slice.call(bodyEl.querySelectorAll('.en-word'));
  const t=String(term||'').trim().toLowerCase();
  return (wid&&list.filter(s=>s.getAttribute('data-wid')===wid)[0])||list.filter(s=>(s.textContent||'').trim().toLowerCase()===t)[0]||null;
}


function openNote(id){
  persistEditor();
  ui.note=id; ui.mode='edit'; ui.tag=null; ui.sideOpen=false;
  render();
  try{ histSyncUndoBtn(); }catch(_){ }
  try{ syncEditorBar(); }catch(_){ }
  const n=state.notes.find(x=>x.id===id);
  restoreCaret(n&&n.sel);
  revealCaret();
}
function backToList(){
  persistEditor();
  try{ bFlushSaveHint(); }catch(_){ }
  ui.mode='list'; ui.sideOpen=false;
  render();
}
function newNote(){
  persistEditor();
  let folderId=ui.folder;
  if(folderId==='all'){
    folderId=state.folders[0]?state.folders[0].id:createFolder('未分类');
  }
  const n={id:uid(),folderId,title:'无标题',content:'',createdAt:Date.now(),updatedAt:Date.now()};
  state.notes.push(n); save();
  ui.note=n.id; ui.mode='edit'; ui.tag=null; ui.sideOpen=false;
  render();
  try{ histSyncUndoBtn(); }catch(_){ }
  try{ syncEditorBar(); }catch(_){ }
  titleEl.focus();
}
function createFolder(name){
  const f={id:uid(),name:name.trim(),createdAt:Date.now()};
  state.folders.push(f); save();
  return f.id;
}

/* ---------- 通用行菜单：文件夹的改名 / 排序 / 删除都收在这里 ---------- */
let rowMenuItems=null;
function openRowMenu(title,items){
  rowMenuItems=items||[];
  const t=$('#rowMenuTitle'); if(t) t.textContent=title||'';
  const body=$('#rowMenuBody');
  if(body) body.innerHTML=rowMenuItems.map((it,i)=>'<button class="mv-item'+(it.danger?' danger':'')+(it.cancel?' mv-item-cancel':'')+'" data-rmi="'+i+'">'+esc(it.text)+'</button>').join('');
  const m=$('#rowMenu'); if(m) m.classList.add('show');
}
function closeRowMenu(){ const m=$('#rowMenu'); if(m) m.classList.remove('show'); }

function moveFolder(id,dir){
  const i=state.folders.findIndex(f=>f.id===id);
  const j=i+dir;
  if(i<0) return;
  if(j<0||j>=state.folders.length){ toast(dir<0?'已经是第一个文件夹':'已经是最后一个文件夹'); return; }
  const list=state.folders.slice();
  const t=list[i]; list[i]=list[j]; list[j]=t;
  state.folders=list; save(); renderSidebar(); syncTabbar();
  toast(dir<0?'已上移':'已下移');
}
function renameFolderDialog(id){
  const f=state.folders.find(x=>x.id===id);
  if(!f) return;
  showConfirm({title:'重命名文件夹',msg:'',okText:'保存'});
  const msg=$('#cfMsg');
  msg.innerHTML='<input id="cfInput" value="'+esc(f.name)+'" style="width:100%;border:1px solid var(--s5);border-radius:10px;padding:11px 12px;font-size:16px;background:var(--s0);color:var(--text);box-sizing:border-box">';
  msg.style.padding='12px 20px 0';
  const inp=msg.querySelector('#cfInput');
  setTimeout(()=>{ inp.focus(); inp.select(); },60);
  confirmCb=()=>{
    const v=inp.value.trim();
    if(!v){ toast('名称不能为空','warn'); return; }
    if(v===f.name) return;
    if(state.folders.some(x=>x.id!==id&&x.name===v)){ toast('已经有同名文件夹了','warn'); return; }
    f.name=v; save(); renderSidebar(); syncTabbar();
    toast('已改名为「'+v+'」');
  };
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#cfOk').click(); } });
}
function openFolderMenu(id){
  const f=state.folders.find(x=>x.id===id);
  if(!f) return;
  const cnt=state.notes.filter(x=>x.folderId===id).length;
  openRowMenu(f.name,[
    {text:'重命名',act:()=>renameFolderDialog(id)},
    {text:'上移一位',act:()=>moveFolder(id,-1)},
    {text:'下移一位',act:()=>moveFolder(id,1)},
    {text:'删除文件夹'+(cnt?'（含 '+cnt+' 篇笔记）':''),danger:true,act:()=>deleteFolder(id)},
    {text:'取消',cancel:true}
  ]);
}

/* ---------- 删除后的「撤销」浮条 ---------- */
let undoState=null, undoTimer=0;
function showUndo(text,fn){
  undoState=fn||null;
  const t=$('#undoTxt'); if(t) t.textContent=text||'';
  const bar=$('#undoBar'); if(bar) bar.classList.add('show');
  document.body.classList.add('undo-bar');
  syncLift();
  clearTimeout(undoTimer);
  undoTimer=setTimeout(hideUndo,8000);
}
function hideUndo(){
  const bar=$('#undoBar'); if(bar) bar.classList.remove('show');
  document.body.classList.remove('undo-bar');
  syncLift();
  undoState=null; clearTimeout(undoTimer);
}
function runUndo(){
  const fn=undoState;
  hideUndo();
  if(!fn) return;
  try{ fn(); }catch(_){ }
  render(); toast('已撤销');
}
function graveDrop(type,id){
  if(!Array.isArray(state.grave)) return;
  state.grave=state.grave.filter(g=>!(g&&g.t===type&&String(g.id)===String(id)));
}

/* 删笔记：不再弹确认，删完 8 秒内可撤销 */
function deleteNote(id){
  const n=state.notes.find(x=>x.id===id);
  if(!n) return;
  const refs=state.words.filter(w=>(w.notes||[]).some(l=>l.noteId===id))
    .map(w=>({w:w,links:(w.notes||[]).slice()}));
  state.notes=state.notes.filter(x=>x.id!==id);
  addGrave('note',id);
  state.words.forEach(w=>{ if(w.notes) w.notes=w.notes.filter(l=>l.noteId!==id); });
  save();
  if(ui.note===id){ ui.note=null; ui.mode='list'; }
  render();
  showUndo('已删除「'+(n.title||'无标题')+'」',()=>{
    if(!state.notes.some(x=>x.id===n.id)) state.notes.push(n);
    graveDrop('note',id);
    refs.forEach(r=>{ r.w.notes=r.links; });
    save();
  });
}
/* 置顶/取消置顶：只加或删一个可选 pinAt 字段，旧笔记没有它默认不置顶、不影响现有数据 */
function toggleNotePin(id){
  const n=state.notes.find(x=>x.id===id);
  if(!n)return;
  if(n.pinAt){ delete n.pinAt; }
  else{ n.pinAt=Date.now(); }
  save();
  render();
  try{ if(navigator.vibrate) navigator.vibrate(8); }catch(_){}
}
/* 长按笔记项弹出的操作菜单（置顶 / 删除） */
function openNoteMenu(id){
  const n=state.notes.find(x=>x.id===id);
  if(!n) return;
  openRowMenu(n.title||'无标题',[
    {text:n.pinAt?'取消置顶':'置顶',act:()=>toggleNotePin(id)},
    {text:'删除笔记',danger:true,act:()=>confirmDeleteNote(id)},
    {text:'取消',cancel:true}
  ]);
}
/* 删除前先确认，确认后再执行 deleteNote */
function confirmDeleteNote(id){
  const n=state.notes.find(x=>x.id===id);
  if(!n) return;
  showConfirm({
    title:'删除这篇笔记？',
    msg:'「'+(n.title||'无标题')+'」会被删除，8 秒内可以撤销。',
    okText:'删除',danger:true,
    onOk(){ deleteNote(id); }
  });
}
/* 删文件夹（会连带笔记）：保留确认框，删完同样可撤销 */
function deleteFolder(id){
  const f=state.folders.find(x=>x.id===id);
  if(!f) return;
  const cnt=state.notes.filter(n=>n.folderId===id).length;
  showConfirm({
    title:'删除文件夹「'+f.name+'」？',
    msg:cnt?('其中 '+cnt+' 篇笔记会一起删除，删完 8 秒内可以撤销。'):'表达库里的单词不受影响。',
    okText:'删除',danger:true,onOk(){
      const idx=state.folders.indexOf(f);
      const notes=state.notes.filter(n=>n.folderId===id);
      const ids=notes.map(n=>n.id);
      const refs=state.words.filter(w=>(w.notes||[]).some(l=>ids.includes(l.noteId)))
        .map(w=>({w:w,links:(w.notes||[]).slice()}));
      state.folders=state.folders.filter(x=>x.id!==id);
      state.notes=state.notes.filter(n=>n.folderId!==id);
      addGrave('folder',id);
      ids.forEach(nid=>addGrave('note',nid));
      state.words.forEach(w=>{ if(w.notes) w.notes=w.notes.filter(l=>!ids.includes(l.noteId)); });
      if(ui.folder===id) ui.folder='all';
      if(ui.note&&ids.includes(ui.note)){ ui.note=null; ui.mode='list'; }
      save(); render();
      showUndo('已删除文件夹「'+f.name+'」'+(notes.length?('和 '+notes.length+' 篇笔记'):''),()=>{
        if(!state.folders.some(x=>x.id===f.id)) state.folders.splice(Math.max(0,idx),0,f);
        notes.forEach(n=>{ if(!state.notes.some(x=>x.id===n.id)) state.notes.push(n); });
        graveDrop('folder',id);
        ids.forEach(nid=>graveDrop('note',nid));
        refs.forEach(r=>{ r.w.notes=r.links; });
        save();
      });
    }
  });
}
function placeWordCaret(span,after){
  if(!span||!bodyEl.contains(span))return;
  bodyEl.focus({preventScroll:true});
  const range=document.createRange();
  if(after)range.setStartAfter(span);
  else range.setStartBefore(span);
  range.collapse(true);
  const selection=window.getSelection();
  selection.removeAllRanges();selection.addRange(range);
}
function handleWordCaretKey(e){
  if(e.isComposing||e.metaKey||e.ctrlKey||e.altKey||e.shiftKey)return;
  const key=e.key;
  if(key!=='ArrowLeft'&&key!=='ArrowRight'&&key!=='Enter')return;
  const selection=window.getSelection();
  if(!selection?.rangeCount||!selection.isCollapsed)return;
  const {startContainer:node,startOffset:offset}=selection.getRangeAt(0);
  if(!bodyEl.contains(node))return;
  const text=node.nodeType===Node.TEXT_NODE;
  const span=(text?node.parentElement:node).closest('.en-word');
  const right=key==='ArrowRight';
  if(span){
    if(key==='Enter'){
      // 有些浏览器会暂时报出卡片内部的光标。让原生换行发生在整张卡片之后。
      placeWordCaret(span,true);
      return;
    }
    e.preventDefault();placeWordCaret(span,right);return;
  }
  if(key==='Enter')return;
  if(text&&offset!==(right?node.length:0))return;
  let neighbor=text?(right?node.nextSibling:node.previousSibling):node.childNodes[right?offset:offset-1];
  while(neighbor?.nodeType===Node.TEXT_NODE&&!neighbor.length)neighbor=right?neighbor.nextSibling:neighbor.previousSibling;
  if(neighbor?.nodeType!==Node.ELEMENT_NODE||!neighbor.matches('.en-word'))return;
  e.preventDefault();placeWordCaret(neighbor,right);
}

/* 点击赋能词（含左侧小圆点）→ 查看单词卡片 */
function handleWordTap(ev){
  const span=ev.target.closest('.en-word');
  if(!span) return;
  ev.preventDefault();
  ev.stopPropagation();
  /* 拿起状态下再点词 = 放回原地，不打开卡片 */
  if(mvState.kind){ mvReset(); toast('已取消，词还在原地'); return; }
  let w=null;
  const wid=span.getAttribute('data-wid');
  if(wid) w=state.words.find(x=>x.id===wid);
  if(!w){
    const t=span.textContent.trim();
    w=state.words.find(x=>x.term.toLowerCase()===t.toLowerCase());
  }
  if(!w){ toast('未找到该单词的记录','warn'); return; }
  openWordModal(w.term,null,null,w);
}

/* ============ 跨笔记剪贴板：整节 / 词条 复制·剪切·粘贴（独立 key） ============ */
const CLIPBOARD_KEY='english-notes-clipboard-v1';
/* 给词加一条笔记关联（去重）；移除一条笔记关联 */
function linkWordToNote(word,noteId,noteTitle){
  if(!word||!noteId)return;
  word.notes=Array.isArray(word.notes)?word.notes:[];
  if(word.notes.some(l=>l.noteId===noteId))return;
  word.notes.push({noteId:noteId,noteTitle:noteTitle||'无标题'});
}
function unlinkWordFromNote(word,noteId){
  if(!word||!Array.isArray(word.notes))return;
  if(Array.from(bodyEl.querySelectorAll('.en-word')).some(span=>findWordOfSpan(span)===word)) return;
  word.notes=word.notes.filter(l=>l.noteId!==noteId);
}
function clipGet(){
  try{ return JSON.parse(localStorage.getItem(CLIPBOARD_KEY))||null; }catch(_){ return null; }
}
function clipSet(obj){
  try{ localStorage.setItem(CLIPBOARD_KEY,JSON.stringify(obj)); }catch(_){ return false; }
  syncEditorBar();
  return true;
}
function clipClear(){
  try{ localStorage.removeItem(CLIPBOARD_KEY); }catch(_){ return false; }
  syncEditorBar();
  return true;
}
function clipWriteAction(entry,words){
  const before=clipGet();
  if(!clipSet(entry)){
    toast('剪贴板保存失败，请重试','warn');
    return false;
  }
  if(entry.mode==='cut') histPush({before,after:entry},words);
  return true;
}
function clipWordsIn(nodes){
  const spans=nodes.flatMap(node=>node.matches('.en-word')?[node]:Array.from(node.querySelectorAll('.en-word')));
  return [...new Set(spans.map(findWordOfSpan).filter(Boolean))];
}
/* 克隆一段 DOM 并清掉临时装饰/属性，得到可保存、可粘贴的干净 HTML */
function clipClean(nodes){
  const tmp=document.createElement('div');
  nodes.forEach(n=>tmp.appendChild(n.cloneNode(true)));
  tmp.querySelectorAll('.mf,.mv-drop').forEach(e=>e.remove());
  tmp.querySelectorAll('.en-word').forEach(e=>{
    e.removeAttribute('contenteditable');e.removeAttribute('spellcheck');
    e.classList.remove('sel-pick');
  });
  return tmp.innerHTML;
}
function clipCopyText(range,text,cut){
  if(!range||range.collapsed||!bodyEl.contains(range.commonAncestorContainer))return false;
  if(cut&&Array.from(bodyEl.querySelectorAll('.en-word')).some(span=>range.intersectsNode(span))){
    toast('这段文字里有词卡。长按词卡可单独剪切。','warn');
    return false;
  }
  const entry={kind:'inline',mode:cut?'cut':'copy',html:'<span>'+esc(text).replace(/\r?\n/g,'<br>')+'</span>',at:Date.now()};
  if(!clipWriteAction(entry,[]))return false;
  if(cut){range.deleteContents();persistEditor();}
  return true;
}
/* 复制 / 剪切单个词条（.en-word 可能是词组，即“一段单词”） */
function clipCopyWord(span,cut){
  if(!span||!bodyEl.contains(span)){ toast('词条不在正文里','warn');return; }
  const word=findWordOfSpan(span);
  const entry={kind:'block',mode:cut?'cut':'copy',html:'<div>'+clipClean([span])+'</div>',at:Date.now()};
  if(!clipWriteAction(entry,word?[word]:[])) return;
  if(cut){
    const block=span.parentElement;
    span.remove();
    unlinkWordFromNote(word,ui.note);
    if(block&&block!==bodyEl&&!(block.textContent.trim()||block.querySelector('.en-word')))block.remove();
    applyFolds(); mvDecorate(); persistEditor();
  }
  toast(cut?'已剪切词条，到其它笔记点粘贴':'已复制词条，到其它笔记点粘贴');
}
function findWordOfSpan(span){
  const wid=span.getAttribute('data-wid');
  let w=wid?state.words.find(x=>x.id===wid):null;
  if(!w){ const t=span.textContent.trim(); w=state.words.find(x=>x.term.toLowerCase()===t.toLowerCase()); }
  return w||null;
}
/* 把剪贴板 HTML 解析成元素数组（浏览器自动建 DOM） */
function clipParse(html){
  const tmp=document.createElement('div');
  tmp.innerHTML=html||'';
  return Array.prototype.slice.call(tmp.children);
}
/* 粘贴到目标节（targetHead=null 表示文末）；复制可多次、剪切粘一次后清空 */
function clipPaste(targetHead,caret=null){
  const c=clipGet();
  if(!c){ toast('剪贴板是空的','warn');return false; }
  const els=clipParse(c.html);
  if(!els.length){ toast('剪贴板内容无效','warn');return false; }
  const atCaret=caret&&caret.collapsed&&bodyEl.contains(caret.startContainer);
  const inline=atCaret&&(c.kind==='inline'||c.kind==='cards');
  let anchor=targetHead?sectionEnd(targetHead):null;
  if(atCaret&&!inline&&caret.startContainer!==bodyEl){
    anchor=caret.startContainer;
    while(anchor.parentNode!==bodyEl)anchor=anchor.parentNode;
  }
  const noteId=ui.note;
  const note=state.notes.find(x=>x.id===noteId);
  const noteTitle=note?note.title:'无标题';
  const frag=document.createDocumentFragment();
  const words=clipWordsIn(els),cut=c.mode==='cut';
  if(inline&&c.kind==='inline')frag.append(...els[0].childNodes);
  else els.forEach((el,i)=>{
    if(inline&&i>0)frag.append(document.createElement('br'));
    frag.append(el);
  });
  const last=frag.lastChild;
  if(cut&&!clipClear()){ toast('剪贴板无法更新，请重试','warn');return false; }
  histPush(cut?{before:c,after:null}:null,words);
  try{
    if(inline)caret.insertNode(frag);
    else if(anchor)anchor.parentNode.insertBefore(frag,anchor.nextSibling);
    else if(atCaret)bodyEl.insertBefore(frag,bodyEl.childNodes[caret.startOffset]||null);
    else bodyEl.appendChild(frag);
  }catch(_){
    if(cut) clipSet(c);
    toast('粘贴失败','warn');return false;
  }
  if(last){
    const next=document.createRange();next.setStartAfter(last);next.collapse(true);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(next);
  }
  /* 粘贴进来的词条：关联到当前目标笔记 */
  words.forEach(word=>linkWordToNote(word,noteId,noteTitle));
  lockWords(bodyEl); mvDecorate(); applyFolds(); persistEditor();
  try{ if(navigator.vibrate)navigator.vibrate(8); }catch(_){}
  return true;
}
/* ============ 系统剪切拦截：选区含词条时引导用应用内按钮，纯文字不拦 ============ */
function selectionHasWord(){
  try{
    const sel=window.getSelection();
    if(!sel||sel.rangeCount===0||sel.isCollapsed)return false;
    const range=sel.getRangeAt(0);
    const ca=range.commonAncestorContainer;
    if(ca&&ca.nodeType===1&&ca.classList&&ca.classList.contains('en-word'))return true;
    const frag=range.cloneContents();
    return !!(frag.querySelector&&frag.querySelector('.en-word'));
  }catch(_){ return false; }
}
function bindSystemClipGuard(){
  document.addEventListener('cut',e=>{
    if(ui.mode!=='edit')return;
    if(selectionHasWord()){
      e.preventDefault();
      toast('词条请用应用内的复制 / 剪切按钮，系统剪切会丢绑定','warn');
    }
  });
  document.addEventListener('paste',e=>{
    if(ui.mode!=='edit')return;
    let html='';
    try{ html=e.clipboardData.getData('text/html')||''; }catch(_){}
    if(html&&html.indexOf('en-word')>=0){
      e.preventDefault();
      toast('词条请点顶部「粘贴」按钮，系统粘贴会丢绑定','warn');
    }
  });
}


