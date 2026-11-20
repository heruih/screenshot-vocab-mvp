/* ===== 13_drag.js · 备忘录式长按移动（自研触摸拖拽，与系统剪贴板分开） =====
   长按单词/整节 → 小菜单「移动 / 复制 / 剪切」
   - 复制 / 剪切：复用应用内剪贴板（保留/移除，单词绑定不丢）
   - 移动：先进入多词选择（可加选），再浮起跟手拖拽，插入线 + 自动滚动；
           拖到左边缘可跨笔记，全程不碰系统剪贴板。
   所有动作都走 histPush，配合全局撤销可逐步撤回。 */

/* ---------------- 公共状态 ---------------- */
const DRAG_PRESS_MS=450;
let dragCtxEl=null, dragGhostEl=null, dragLineEl=null, dragSelBarEl=null;
let pressTimer=0, pressSX=0, pressSY=0, pressKind='', pressNode=null, pressMoved=false, suppressClick=false;
/* 选择态：待移动的词条集合 */
let selActive=false, selSpans=[], dragNodes=[];
/* 拖拽态 */
let dragOn=false, dragPayload=null, dragAutoRAF=0, dragAutoDir=0, dragInsert=null, dragPointerId=null;
/* 跨笔记暂存（内存，不写 localStorage） */
let crossPayload=null;

function ensureDragEls(){
  if(!dragCtxEl){
    dragCtxEl=document.createElement('div');dragCtxEl.id='dragCtx';dragCtxEl.className='drag-ctx hidden';
    dragCtxEl.innerHTML=
      '<button class="drag-ctx-item" data-dact="move"><span class="dci-ico">✥</span>移动</button>'+
      '<button class="drag-ctx-item" data-dact="copy"><span class="dci-ico">⧉</span>复制</button>'+
      '<button class="drag-ctx-item" data-dact="cut"><span class="dci-ico">✂</span>剪切</button>';
    document.body.appendChild(dragCtxEl);
    dragCtxEl.addEventListener('click',e=>{
      const b=e.target.closest('[data-dact]');if(!b)return;
      const act=b.getAttribute('data-dact');
      handleCtxAction(act);
    });
  }
  if(!dragGhostEl){
    dragGhostEl=document.createElement('div');dragGhostEl.id='dragGhost';dragGhostEl.className='drag-ghost hidden';
    document.body.appendChild(dragGhostEl);
  }
  if(!dragLineEl){
    dragLineEl=document.createElement('div');dragLineEl.id='dragLine';dragLineEl.className='drag-line hidden';
    document.body.appendChild(dragLineEl);
  }
  if(!dragSelBarEl){
    dragSelBarEl=document.createElement('div');dragSelBarEl.id='dragSelBar';dragSelBarEl.className='drag-selbar hidden';
    dragSelBarEl.innerHTML=
      '<span class="dsel-count" id="dselCount">已选 1 个</span>'+
      '<button class="dsel-btn ghost" id="dselCancel" type="button">取消</button>'+
      '<button class="dsel-btn primary" id="dselMove" type="button">移动</button>';
    document.body.appendChild(dragSelBarEl);
    dragSelBarEl.querySelector('#dselCancel').onclick=cancelSelect;
    dragSelBarEl.querySelector('#dselMove').onclick=confirmSelect;
  }
}

/* ---------------- 长按检测 ---------------- */
function initDragPress(){
  bodyEl.addEventListener('touchstart',e=>{
    clearTimeout(pressTimer);pressMoved=false;pressKind='';pressNode=null;
    if(ui.mode!=='edit'||ui.sideOpen)return;
    if(document.querySelector('.modal.show,.ai-page.show,#shotViewer.show,#writeModal.show'))return;
    const tg=e.target;
    if(tg.closest&&tg.closest('.mf,.mv-drop,.drag-ctx,.drag-selbar'))return;
    const word=tg.closest&&tg.closest('.en-word');
    const head=tg.closest&&tg.closest('.nh');
    const t=e.touches[0];pressSX=t.clientX;pressSY=t.clientY;
    if(word&&bodyEl.contains(word)){pressKind='word';pressNode=word;}
    else if(head&&bodyEl.contains(head)){
      /* 整节入口只在标题左侧小方块区域，避免和折叠/打字冲突 */
      const r=head.getBoundingClientRect();
      if(t.clientX-r.left<=32){pressKind='section';pressNode=head;}
    }
    if(!pressKind)return;
    const node=pressNode;
    pressTimer=setTimeout(()=>{
      if(pressMoved)return;
      suppressClick=true;
      openContextMenu(pressKind,node,pressSX,pressSY);
      try{if(navigator.vibrate)navigator.vibrate(10);}catch(_){}
    },DRAG_PRESS_MS);
  },{passive:true});
  bodyEl.addEventListener('touchmove',e=>{
    if(!pressTimer)return;
    const t=e.touches[0];
    if(Math.abs(t.clientX-pressSX)>10||Math.abs(t.clientY-pressSY)>10){pressMoved=true;clearTimeout(pressTimer);pressTimer=0;}
  },{passive:true});
  ['touchend','touchcancel'].forEach(ev=>bodyEl.addEventListener(ev,()=>{clearTimeout(pressTimer);pressTimer=0;},{passive:true}));
  /* 长按后松手，阻止 click 打开单词卡片（仅一次） */
  editorWrap.addEventListener('click',e=>{
    if(suppressClick){e.stopPropagation();e.preventDefault();suppressClick=false;}
  },true);
}

/* ---------------- 上下文菜单 ---------------- */
function openContextMenu(kind,node,x,y){
  ensureDragEls();
  dragCtxEl.classList.remove('hidden');
  dragCtxEl.dataset.kind=kind;
  /* 菜单定位在手指附近，避免超出屏幕 */
  const w=dragCtxEl.offsetWidth||150,h=dragCtxEl.offsetHeight||140;
  let left=x+14,top=y-h/2;
  if(left+w>window.innerWidth-8)left=x-w-14;
  left=Math.max(8,left);top=Math.max(8,Math.min(top,window.innerHeight-h-8));
  dragCtxEl.style.left=left+'px';dragCtxEl.style.top=top+'px';
  dragCtxEl._node=node;
}
function hideContextMenu(){if(dragCtxEl)dragCtxEl.classList.add('hidden');}
function handleCtxAction(act){
  const kind=dragCtxEl.dataset.kind,node=dragCtxEl._node;
  hideContextMenu();
  if(!node)return;
  if(act==='copy'){
    if(kind==='word')clipCopyWord(node,false);else clipCopySection(node,false);
  }else if(act==='cut'){
    if(kind==='word')clipCopyWord(node,true);else clipCopySection(node,true);
  }else if(act==='move'){
    if(kind==='section'){
      /* 整节直接进入拖拽，无需多选 */
      selSpans=[];
      beginDrag(secGroup(node));
    }else{
      beginSelect(node);
    }
  }
}

/* ---------------- 多词选择态 ---------------- */
function beginSelect(first){
  selActive=true;selSpans=[first];
  document.body.classList.add('drag-select');
  dragSelBarEl.classList.remove('hidden');
  updateSelectCount();syncSelPicks();
  /* 选择态下点其它词加入/取消；点空白处不做处理 */
}
function updateSelectCount(){
  const c=dragSelBarEl.querySelector('#dselCount');
  if(c)c.textContent='已选 '+selSpans.length+' 个';
}
function syncSelPicks(){
  bodyEl.querySelectorAll('.en-word.sel-pick').forEach(e=>e.classList.remove('sel-pick'));
  selSpans.forEach(sp=>sp.classList.add('sel-pick'));
}
function handleSelectTap(e){
  if(!selActive)return;
  const sp=e.target.closest&&e.target.closest('.en-word');
  if(!sp||!bodyEl.contains(sp))return;
  e.preventDefault();e.stopPropagation();
  const i=selSpans.indexOf(sp);
  if(i>=0){if(selSpans.length>1)selSpans.splice(i,1);}
  else selSpans.push(sp);
  updateSelectCount();syncSelPicks();
}
function confirmSelect(){
  if(!selSpans.length)return;
  const nodes=collectWordBlocks(selSpans);
  endSelect();
  beginDrag(nodes);
}
function cancelSelect(){
  endSelect();toast('已取消，原样没动');
}
function endSelect(){
  selActive=false;selSpans=[];
  bodyEl.querySelectorAll('.en-word.sel-pick').forEach(e=>e.classList.remove('sel-pick'));
  document.body.classList.remove('drag-select');
  dragSelBarEl.classList.add('hidden');
}
/* 把选中的词条整理成要搬运的顶层块（保留各自所在块结构） */
function collectWordBlocks(spans){
  const blocks=[];
  spans.forEach(sp=>{
    let b=sp.parentElement;
    if(!b)return;
    if(b===bodyEl){
      /* 词直接挂在正文下，单独包一层 */
      if(blocks.indexOf(sp)<0)blocks.push(sp);
    }else if(blocks.indexOf(b)<0)blocks.push(b);
  });
  return blocks;
}

/* ---------------- 拖拽态 ---------------- */
function beginDrag(nodes){
  ensureDragEls();
  if(!nodes||!nodes.length){toast('没有可移动的内容','warn');return;}
  dragNodes=nodes.filter(n=>n&&n.isConnected);
  if(!dragNodes.length){toast('内容已不在正文里','warn');return;}
  histPush();
  dragOn=true;
  document.body.classList.add('drag-active');
  /* 幽灵：汇总选中内容，浮起跟手 */
  dragGhostEl.innerHTML='';
  dragNodes.forEach(n=>{
    const c=n.cloneNode(true);
    dragGhostEl.appendChild(c);
  });
  dragGhostEl.classList.remove('hidden');
  /* 原节点半透明占位，先不移除（松手成功才移除） */
  dragNodes.forEach(n=>n.classList.add('drag-src'));
  showDragLine();
}
function endDrag(){
  dragOn=false;
  cancelAutoScroll();
  if(dragGhostEl)dragGhostEl.classList.add('hidden');
  hideDragLine();
  document.body.classList.remove('drag-active');
  if(dragNodes)dragNodes.forEach(n=>{try{n.classList.remove('drag-src');}catch(_){}});
  dragNodes=[];dragInsert=null;
}

/* 触摸在 document 上跟踪，手指可移出正文 */
function initDragMove(){
  document.addEventListener('touchmove',e=>{
    if(!dragOn)return;
    if(e.touches.length!==1)return;
    const t=e.touches[0];
    moveGhost(t.clientX,t.clientY);
    /* 左边缘 → 跨笔记 */
    if(t.clientX<36){triggerCrossNote();return;}
    updateAutoScroll(t.clientY);
    dragInsert=computeInsert(t.clientY);
    paintDragLine(dragInsert);
  },{passive:false});
  document.addEventListener('touchend',e=>{
    if(!dragOn)return;
    if(crossPayload)return; /* 已进入跨笔记流程，交给后续 */
    finishDrop();
  });
  document.addEventListener('touchcancel',()=>{if(dragOn)cancelDrag();});
}
function moveGhost(x,y){
  const gw=dragGhostEl.offsetWidth||160,gh=dragGhostEl.offsetHeight||60;
  let left=x+12,top=y-gh/2;
  left=Math.max(4,Math.min(left,window.innerWidth-gw-4));
  top=Math.max(4,Math.min(top,window.innerHeight-gh-4));
  dragGhostEl.style.left=left+'px';dragGhostEl.style.top=top+'px';
}
/* 计算插入点：按手指 y 命中顶层块，比较中点决定前/后 */
function computeInsert(y){
  const kids=Array.prototype.slice.call(bodyEl.children).filter(n=>!n.classList.contains('drag-src')&&n.id!=='dragLine');
  if(!kids.length)return {before:null,after:null};
  for(let i=0;i<kids.length;i++){
    const r=kids[i].getBoundingClientRect();
    if(y<r.bottom){
      if(y<=(r.top+r.height/2))return {before:kids[i],after:i>0?kids[i-1]:null};
      return {before:i<kids.length-1?kids[i+1]:null,after:kids[i]};
    }
  }
  return {before:null,after:kids[kids.length-1]};
}
function showDragLine(){dragLineEl.classList.remove('hidden');}
function hideDragLine(){dragLineEl.classList.add('hidden');}
function paintDragLine(ins){
  if(!ins){hideDragLine();return;}
  const ref=ins.before||ins.after;
  if(!ref){hideDragLine();return;}
  const r=ref.getBoundingClientRect();
  const lineY=ins.before?r.top:r.bottom;
  const bodyR=bodyEl.getBoundingClientRect();
  dragLineEl.style.left=bodyR.left+'px';
  dragLineEl.style.width=bodyR.width+'px';
  dragLineEl.style.top=lineY+'px';
  dragLineEl.classList.remove('hidden');
}
/* 自动滚动：手指贴近视口上下边缘时持续滚动正文 */
function updateAutoScroll(y){
  const TOP=70,BOTTOM=window.innerHeight-90;
  if(y<TOP)dragAutoDir=-1;
  else if(y>BOTTOM)dragAutoDir=1;
  else dragAutoDir=0;
  if(dragAutoDir&&!dragAutoRAF)autoScrollLoop();
}
function autoScrollLoop(){
  if(!dragOn||!dragAutoDir){dragAutoRAF=0;return;}
  bodyEl.scrollTop+=dragAutoDir*14;
  if(dragInsert)paintDragLine(dragInsert);
  dragAutoRAF=requestAnimationFrame(autoScrollLoop);
}
function cancelAutoScroll(){
  dragAutoDir=0;
  if(dragAutoRAF){cancelAnimationFrame(dragAutoRAF);dragAutoRAF=0;}
}

/* 完成同笔记内放置 */
function finishDrop(){
  const ins=dragInsert;
  const nodes=dragNodes.slice();
  if(!ins){cancelDrag();return;}
  const frag=document.createDocumentFragment();
  nodes.forEach(n=>frag.appendChild(n));
  try{
    if(ins.before)bodyEl.insertBefore(frag,ins.before);
    else bodyEl.appendChild(frag);
  }catch(_){cancelDrag();return;}
  /* 搬运后清理占位、锁定词条、装饰、折叠、保存 */
  nodes.forEach(n=>n.classList.remove('drag-src'));
  try{lockWords(bodyEl);}catch(_){}
  try{mvDecorate();}catch(_){}
  try{applyFolds();}catch(_){}
  try{persistEditor();}catch(_){}
  endDrag();
  try{if(navigator.vibrate)navigator.vibrate(8);}catch(_){}
  toast('已移动');
}
function cancelDrag(){
  /* 取消：节点从未真正移除，恢复样式即可 */
  endDrag();
  toast('已取消，原样没动');
}

/* ---------------- 跨笔记 ---------------- */
function triggerCrossNote(){
  if(crossPayload)return;
  const nodes=dragNodes.slice();
  /* 干净 HTML + 源笔记，用于在目标笔记重建；源笔记先移除（移动语义） */
  const html=clipClean(nodes);
  const sourceNoteId=ui.note;
  crossPayload={html,sourceNoteId,at:Date.now()};
  /* 从正文移除选中节点并清理空块 */
  nodes.forEach(n=>{
    const block=n.parentElement;
    n.remove();
    if(block&&block!==bodyEl&&!(block.textContent.trim()||block.querySelector('.en-word')))block.remove();
  });
  try{mvDecorate();applyFolds();persistEditor();}catch(_){}
  endDrag();
  /* 打开抽屉让用户选目标笔记 */
  ui.sideOpen=true;render();
  toast('选目标笔记，进去后点位置放置');
}
/* 进入目标笔记后：进入放置态，等待点选插入位置 */
function enterCrossPlace(){
  ensureDragEls();
  dragOn=true;
  document.body.classList.add('drag-active');
  dragGhostEl.innerHTML='<div class="cross-ghost-note">放开以插入到这里</div>';
  dragGhostEl.classList.remove('hidden');
  showDragLine();
}
function finishCrossDrop(){
  const ins=dragInsert,payload=crossPayload;
  if(!payload){cancelCross();return;}
  const tmp=document.createElement('div');tmp.innerHTML=payload.html;
  const els=Array.prototype.slice.call(tmp.children);
  if(!els.length){cancelCross();return;}
  const frag=document.createDocumentFragment();
  els.forEach(el=>frag.appendChild(el));
  try{
    if(ins&&ins.before)bodyEl.insertBefore(frag,ins.before);
    else bodyEl.appendChild(frag);
  }catch(_){cancelCross();return;}
  /* 关联到目标笔记 */
  const noteId=ui.note,note=state.notes.find(x=>x.id===noteId),noteTitle=note?note.title:'无标题';
  els.forEach(el=>el.querySelectorAll&&el.querySelectorAll('.en-word').forEach(sp=>{
    const wm=findWordOfSpan(sp);if(wm)linkWordToNote(wm,noteId,noteTitle);
  }));
  try{lockWords(bodyEl);mvDecorate();applyFolds();persistEditor();}catch(_){}
  crossPayload=null;
  endDrag();
  toast('已移动到这篇笔记');
}
function cancelCross(){
  /* 回滚：把内容插回源笔记（简单追加到文末，保证不丢；用户可再整理） */
  const payload=crossPayload;
  if(payload&&payload.sourceNoteId){
    const src=state.notes.find(n=>n.id===payload.sourceNoteId);
    if(src)src.content=(src.content||'')+payload.html;
  }
  crossPayload=null;
  if(dragOn)endDrag();
  toast('已取消，内容已退回原笔记');
}

/* 包装 openNote：进入笔记时若有跨笔记 payload，进入放置态 */
const _dragOpenNote=openNote;
openNote=function(id){
  _dragOpenNote(id);
  if(crossPayload&&id!==crossPayload.sourceNoteId){
    enterCrossPlace();
  }
};
/* 放置态下 touchend 走跨笔记落位 */
function initCrossHook(){
  document.addEventListener('touchend',()=>{
    if(crossPayload&&dragOn){finishCrossDrop();}
  });
}

/* ---------------- 初始化 ---------------- */
function initDrag(){
  ensureDragEls();
  initDragPress();
  initDragMove();
  initCrossHook();
  /* 选择态词条点选：用 click 捕获，先于 handleWordTap */
  editorWrap.addEventListener('click',e=>{if(selActive)handleSelectTap(e);},true);
}
