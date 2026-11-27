/* ============ 截图导入：PP-OCR 整句识别 → 可点单词/自由编辑 → 挂载 ============ */
let ocrDataUrl='';
/* 收件箱笔记过滤：null=总收件箱看全部；否则只看这一篇笔记 */
let inboxFilterNoteId=null;
const SHOT_INBOX_KEY='en-shot-inbox-v1';
function inboxReadLocal(){try{const v=JSON.parse(localStorage.getItem(SHOT_INBOX_KEY)||'[]');return Array.isArray(v)?v:[];}catch(_){return [];}}
let inboxCache=null,inboxReady=false,inboxUseIdb=false;
const INBOX_LEGACY_KEY='all';
async function inboxInit(){
  if(inboxReady)return;
  try{
    await idbOpen();
    inboxUseIdb=true;
    /* 一次性迁移：旧的单 key 'all' 数组 → 每条按 id 独立存储（幂等、可回滚） */
    const legacy=await idbGet(IDB_STORE_INBOX,INBOX_LEGACY_KEY);
    if(Array.isArray(legacy)&&legacy.length){
      for(const item of legacy){
        if(!(await idbHasKey(IDB_STORE_INBOX,item.id))){
          await idbSet(IDB_STORE_INBOX,item.id,item);
        }
      }
      /* 核对独立条目已覆盖旧数组全部 id，才删旧 key；否则保留，下次重试 */
      const migrated=await idbGetAll(IDB_STORE_INBOX);
      const ids=new Set(migrated.map(x=>x.id));
      if(legacy.every(x=>ids.has(x.id))&&migrated.length>=legacy.length){
        await idbDelete(IDB_STORE_INBOX,INBOX_LEGACY_KEY);
      }
    }
    inboxCache=await idbGetAll(IDB_STORE_INBOX);
    /* IDB 已接管，清掉 LS 旧收件箱副本 */
    try{ localStorage.removeItem(SHOT_INBOX_KEY); }catch(_){ }
  }catch(e){
    inboxUseIdb=false;
    inboxCache=inboxReadLocal();
  }
  inboxReady=true;
}
function ocrInboxRead(){
  if(inboxReady)return inboxCache;
  return inboxReadLocal();
}
/* 单条写入：IDB 只写这一条（O(1)，不再重写全部）；LS 回退整体写 */
async function inboxPutItem(item){
  if(!inboxReady)await inboxInit();
  if(inboxUseIdb)await idbSet(IDB_STORE_INBOX,item.id,item);
  const idx=inboxCache.findIndex(x=>x.id===item.id);
  const next=inboxCache.slice();
  if(idx>=0)next[idx]=item;else next.push(item);
  if(!inboxUseIdb&&!aStore(SHOT_INBOX_KEY,JSON.stringify(next)))throw new Error('收件箱写入失败');
  inboxCache=next;
}
async function ocrRememberInboxText(row,text){
  const id=row.dataset.inboxId;
  if(ocrInboxBusy.has(id)||ocrDraftFor(row).crop) return;
  const item=ocrInboxRead().find(entry=>entry.id===id);
  if(item) await inboxPutItem({...item,text,candidates:ocrCandidates(text)});
}
/* 单条删除：IDB 只删这一条；LS 回退整体写 */
async function inboxRemoveItem(id){
  if(!inboxReady)await inboxInit();
  if(inboxUseIdb)await idbDelete(IDB_STORE_INBOX,id);
  const next=inboxCache.filter(x=>x.id!==id);
  if(!inboxUseIdb&&!aStore(SHOT_INBOX_KEY,JSON.stringify(next)))throw new Error('收件箱写入失败');
  inboxCache=next;
}
function ocrNorm(s){return (String(s||'').normalize('NFKC').toLowerCase().replace(/’/g,"'").match(/[a-z0-9]+(?:'[a-z0-9]+)*/g)||[]).join(' ');}
function ocrNearToken(left,right){
  if(Math.min(left.length,right.length)<4||Math.abs(left.length-right.length)>1)return false;
  if(left.length>right.length)[left,right]=[right,left];
  let i=0;
  while(i<left.length&&left[i]===right[i])i++;
  if(right.length>left.length)return left.slice(i)===right.slice(i+1);
  return left.slice(i+1)===right.slice(i+1)||
    (left[i]===right[i+1]&&left[i+1]===right[i]&&left.slice(i+2)===right.slice(i+2));
}
function ocrCandidates(text){
  const clean=ocrNorm(text);if(!clean)return [];
  const hay=' '+clean+' ',tokens=clean.split(' ');
  return (state.words||[]).map(w=>{
    const term=String(w.term||'').trim(),needle=ocrNorm(term);if(!needle)return null;
    const parts=needle.split(' '),index=hay.indexOf(' '+needle+' ');
    if(index>=0)return {id:w.id,term,kind:'exact',count:parts.length,index};
    for(let start=0;start<=tokens.length-parts.length;start++){
      let errors=0;
      for(let i=0;i<parts.length;i++){
        if(parts[i]===tokens[start+i])continue;
        if(++errors>1||!ocrNearToken(parts[i],tokens[start+i])){errors=2;break;}
      }
      if(errors===1)return {id:w.id,term,kind:'near',count:parts.length,index:start};
    }
    return null;
  }).filter(Boolean).sort((a,b)=>Number(b.kind==='exact')-Number(a.kind==='exact')||b.count-a.count||a.index-b.index).slice(0,8);
}
function ocrManualTerms(value){return value.split(/[,，、;；]/).map(term=>term.trim()).filter(Boolean);}
function ocrMatchGroup(label,list,selected){
  if(!list.length)return '';
  return '<div class="ocr-match-label">'+label+'</div><div class="cand-chips">'+list.map(c=>{
    const on=selected.has(c.id);
    return '<button type="button" class="cand-chip'+(on?' on':'')+'" data-cand="'+esc(c.id)+'" aria-pressed="'+on+'">'+esc(c.term)+'</button>';
  }).join('')+'</div>';
}
function ocrRenderMatches(container,text,query){
  const selected=new Set(Array.from(container.querySelectorAll('[data-cand].on')).map(chip=>chip.dataset.cand));
  const candidates=ocrCandidates(text),autoIds=new Set(candidates.map(c=>c.id));
  const needle=ocrNorm(query.split(/[,，、;；]/).at(-1));
  const search=needle?state.words.filter(w=>!autoIds.has(w.id)&&!selected.has(w.id)&&ocrNorm(w.term).includes(needle))
    .sort((a,b)=>ocrNorm(a.term).indexOf(needle)-ocrNorm(b.term).indexOf(needle)||a.term.length-b.term.length).slice(0,6):[];
  const kept=state.words.filter(w=>selected.has(w.id)&&!autoIds.has(w.id));
  container.innerHTML=ocrMatchGroup('词库匹配',candidates.filter(c=>c.kind==='exact'),selected)+
    ocrMatchGroup('近似匹配 · 请核对原图',candidates.filter(c=>c.kind==='near'),selected)+
    ocrMatchGroup('已选',kept,selected)+ocrMatchGroup('词库搜索',search,selected)||
    (text?'<span class="cand-empty">词库没有匹配，可在下方搜词或输入。</span>':'');
}
function ocrRenderMatchArea(area){
  ocrRenderMatches(area.querySelector('[data-ocr-matches]'),area.querySelector('[data-ocr-text]')?.value||'',area.querySelector('[data-ocr-term]').value);
  ocrRenderTermPicker(area);
}
function ocrToggleMatch(chip,area){
  const on=chip.classList.toggle('on');
  chip.setAttribute('aria-pressed',String(on));
  const input=area.querySelector('[data-ocr-term]');
  const query=ocrNorm(input.value.split(/[,，、;；]/).at(-1));
  if(on&&query&&ocrNorm(chip.textContent).includes(query)){
    input.value=input.value.replace(/[^,，、;；]*$/,'');
    ocrRenderMatchArea(area);
  }
  ocrRefreshTermPicker(area);
}
function ocrMatchTargets(area){
  const ids=new Set(Array.from(area.querySelectorAll('[data-cand].on')).map(chip=>chip.dataset.cand));
  const targets=new Map();
  const existing=new Map(state.words.map(w=>[ocrNorm(w.term),w.term]));
  if(area.querySelector('[data-ocr-text]')){
    for(const [key,pick] of ocrDraftFor(area).picks) targets.set(key,existing.get(key)||pick.term);
  }
  for(const word of state.words){if(ids.has(word.id))targets.set(ocrNorm(word.term),word.term);}
  for(const term of ocrManualTerms(area.querySelector('[data-ocr-term]').value)){
    const key=ocrNorm(term);
    if(key&&!targets.has(key))targets.set(key,existing.get(key)||term);
  }
  return [...targets.values()];
}
function ocrInboxSelection(){return Array.from($('#ocrBatchList').querySelectorAll('[data-inbox-pick]:checked')).map(input=>input.closest('[data-inbox-id]').dataset.inboxId);}
function ocrSyncBatchMatch(){
  const count=ocrInboxSelection().length;
  const area=$('#ocrBatchMatch');
  area.hidden=!count;
  if(!count){area.querySelector('[data-ocr-term]').value='';area.querySelector('[data-ocr-matches]').replaceChildren();}
  $('#ocrBatchMatchCount').textContent='已选 '+count+' 张截图';
}
function ocrInboxRender(){
  if(typeof updateNoteInboxBar==='function')updateNoteInboxBar();
  const box=$('#ocrBatchList');if(!box)return;
  const all=ocrInboxRead();
  /* 先按笔记过滤，再按时间倒序（最新导入的排第一） */
  const list=all.filter(x=>!inboxFilterNoteId||x.noteId===inboxFilterNoteId)
    .slice().sort((a,b)=>(b.at||0)-(a.at||0));
  if(!list.length){
    box.innerHTML='<div class="ocr-tip">'+(inboxFilterNoteId?'这篇笔记没有待处理截图。':'收件箱为空。一次从相册多选截图后，这里会按识别结果给出候选词。')+'</div>';
    ocrSyncBatchMatch();
    return;
  }
  const itemHtml=item=>{
    return '<article class="ocr-inbox-item" data-inbox-id="'+esc(item.id)+'" data-ocr-area>'+
      '<div class="ocr-inbox-preview"><button class="ocr-preview-button" type="button" data-ocr-preview aria-label="放大截图">'+
      '<img src="'+esc(item.dataUrl)+'" loading="lazy" alt="待匹配截图"></button>'+
      '<button class="mini-btn ocr-frame-row" type="button" data-ocr-frame>框选区域</button>'+
      '<button class="mini-btn" type="button" data-ocr-restore hidden>恢复原图</button>'+
      '<small class="ocr-crop-note" data-ocr-crop-note hidden>本次保存裁后的图片</small>'+
      '<label><input type="checkbox" data-inbox-pick> 批量选中</label></div>'+
      '<div class="ocr-inbox-main"><details class="ocr-text-edit" hidden><summary>修改识别文字</summary>'+
      '<textarea class="ocr-inbox-text" data-ocr-text aria-label="识别文字" rows="2" placeholder="可补写识别文字">'+esc(item.text||'')+'</textarea></details>'+
      '<div data-ocr-row-status class="ocr-tip" role="status"></div><div data-ocr-matches></div>'+
      '<input data-ocr-term aria-label="手动搜词或输入表达" placeholder="搜词或输入表达，多个用逗号分隔">'+
      '<div class="ocr-inbox-actions"><button class="mini-btn" type="button" data-inbox-confirm>保存表达</button>'+
      '<button class="mini-btn danger" type="button" data-inbox-delete>删除</button></div></div></article>';
  };
  /* 总收件箱：按笔记分组，组内已按时间倒序；noteId 为空或笔记已删的归到「未分到笔记」 */
  const groups=[],gmap={};
  list.forEach(item=>{
    const n=item.noteId?state.notes.find(x=>x.id===item.noteId):null;
    const key=n?n.id:'__none__';
    if(!gmap[key]){const g={name:n?(n.title||'无标题'):'未分到笔记',items:[]};gmap[key]=g;groups.push(g);}
    gmap[key].items.push(item);
  });
  box.innerHTML=groups.map(g=>'<div class="inbox-group"><div class="inbox-group-title">'+esc(g.name)+'（<span data-inbox-count>'+g.items.length+'</span>）</div>'+g.items.map(itemHtml).join('')+'</div>').join('');
  box.querySelectorAll('[data-inbox-id]').forEach(row=>{
    const draft=ocrDraftFor(row);
    if(draft.crop){
      row.querySelector('[data-ocr-text]').value=draft.text||'';
      ocrShowImageChoice(row);
    }
    ocrRenderMatchArea(row);
  });
  ocrSyncBatchMatch();
}
function ocrRemoveInboxRow(row){
  const group=row?.closest('.inbox-group');
  if(group){
    row.remove();
    const count=group.querySelectorAll('[data-inbox-id]').length;
    if(count)group.querySelector('[data-inbox-count]').textContent=String(count);
    else group.remove();
  }
  if(!$('#ocrBatchList').querySelector('[data-inbox-id]'))ocrInboxRender();
  else ocrSyncBatchMatch();
}
function ocrShowPanel(panel){
  $('#ocrImport').classList.toggle('hidden',panel!=='import');
  $('#ocrFolderPick').classList.toggle('hidden',panel!=='folder');
  $('#ocrBatch').classList.toggle('hidden',panel!=='inbox');
  const toggle=$('#ocrInboxOpen');
  toggle.hidden=panel==='folder';
  toggle.textContent=panel==='inbox'?'返回截图导入':'批量收件箱';
  $('#ocrSheet .wm-body').scrollTop=0;
}
function ocrInboxToggle(){
  if(ocrMountBusy)return;
  if($('#ocrBatch').classList.contains('hidden')) ocrInboxShow();
  else ocrShowPanel('import');
}
function ocrInboxShow(noteId=null){
  if(!ocrBatchImporting){
    inboxFilterNoteId=noteId;
    $('#ocrInboxStatus').textContent=noteId?'这篇笔记的待处理截图，确认后挂到对应词条。':
      '逐张确认词条，或勾选几张截图一起挂到同一个词条。';
  }
  $('#ocrSheet').classList.add('show');
  ocrShowPanel('inbox');
  ocrInboxRender();
}
/* 打开某篇笔记自己的收件箱（只看这篇笔记的待处理截图） */
function ocrInboxShowNote(noteId){
  ocrInboxShow(noteId||null);
}
/* 更新顶栏收图箱角标：显示全部待处理截图数，永远存在（0 也显示） */
function updateNoteInboxBar(){
  const numEl=$('#hdrInboxN');
  if(!numEl)return;
  const n=ocrInboxRead().length;
  numEl.textContent=String(n);
  numEl.classList.toggle('zero',n===0);
}
/* 导入多文件前选择归属文件夹：返回 folderId；用户取消则 resolve(null) */
function pickNoteForImport(){
  return new Promise(resolve=>{
    $('#ocrSheet').classList.add('show');
    const noteSel=$('#ocrNoteSelect'),folderSel=$('#ocrNewNoteFolder'),nameInput=$('#ocrNewNoteName');
    const fill=()=>{
      const groups=state.folders.map(f=>{
        const notes=state.notes.filter(n=>n.folderId===f.id);
        if(!notes.length)return '';
        return '<optgroup label="'+esc(f.name)+'">'+notes.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.title||'无标题')+'</option>').join('')+'</optgroup>';
      }).join('');
      const loose=state.notes.filter(n=>!state.folders.some(f=>f.id===n.folderId));
      noteSel.innerHTML='<option value="">选择笔记…</option>'+groups+(loose.length?'<optgroup label="未分类">'+loose.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.title||'无标题')+'</option>').join('')+'</optgroup>':'');
      folderSel.innerHTML=state.folders.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name)+'</option>').join('');
      nameInput.value='';
    };
    fill();
    const recent=firstShotState().lastNote;
    if(state.notes.some(n=>n.id===recent))noteSel.value=recent;
    ocrShowPanel('folder');
    const startBtn=$('#ocrFolderStart'),cancelBtn=$('#ocrFolderCancel'),newBtn=$('#ocrNoteNewBtn');
    const cleanup=()=>{ $('#ocrFolderPick').classList.add('hidden'); startBtn.onclick=null;cancelBtn.onclick=null;newBtn.onclick=null; };
    newBtn.onclick=()=>{
      const nm=nameInput.value.trim();
      if(!nm){toast('先输入笔记大标题','warn');return;}
      let fid=folderSel.value;
      if(!fid){fid=state.folders[0]?state.folders[0].id:createFolder('未分类');}
      const n={id:uid(),folderId:fid,title:nm,content:'',createdAt:Date.now(),updatedAt:Date.now()};
      state.notes.push(n);save();fill();noteSel.value=n.id;
      toast('已新建笔记','ok');
    };
    startBtn.onclick=()=>{
      const nid=noteSel.value;
      if(!nid){toast('选一篇笔记，或在下面新建','warn');return;}
      cleanup();resolve(nid);
    };
    cancelBtn.onclick=()=>{cleanup();resolve(null);};
  });
}
