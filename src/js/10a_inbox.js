/* ============ 截图导入：PP-OCR 整句识别 → 可点单词/自由编辑 → 挂载 ============ */
let ocrSel=[];
let ocrDataUrl='';
let ocrWords=[];
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
function inboxPutItem(item){
  if(inboxUseIdb){
    const idx=inboxCache.findIndex(x=>x.id===item.id);
    if(idx>=0)inboxCache[idx]=item; else inboxCache.push(item);
    return idbSet(IDB_STORE_INBOX,item.id,item)
      .catch(()=>{ try{ aStore(SHOT_INBOX_KEY,JSON.stringify(inboxCache)); }catch(_){ } });
  }
  const idx=inboxCache.findIndex(x=>x.id===item.id);
  if(idx<0)inboxCache.push(item);
  return Promise.resolve(aStore(SHOT_INBOX_KEY,JSON.stringify(inboxCache)));
}
/* 单条删除：IDB 只删这一条；LS 回退整体写 */
function inboxRemoveItem(id){
  inboxCache=inboxCache.filter(x=>x.id!==id);
  if(inboxUseIdb){
    return idbDelete(IDB_STORE_INBOX,id)
      .catch(()=>{ try{ aStore(SHOT_INBOX_KEY,JSON.stringify(inboxCache)); }catch(_){ } });
  }
  return Promise.resolve(aStore(SHOT_INBOX_KEY,JSON.stringify(inboxCache)));
}
function ocrNorm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');}
function ocrCandidates(text){
  const hay=ocrNorm(text);if(!hay)return [];
  return (state.words||[]).map(w=>{
    const term=String(w.term||'').trim(),needle=ocrNorm(term);if(!needle)return null;
    let score=0;
    if(hay.includes(needle))score=100+needle.length;
    else{
      const parts=needle.split(' ').filter(Boolean),hits=parts.filter(p=>hay.split(' ').includes(p)).length;
      if(hits===parts.length&&parts.length>1)score=70+parts.length;
      else if(hits>0)score=hits/parts.length*45;
    }
    (w.examples||[]).some(x=>{const ex=ocrNorm(x&&x.en);if(ex&&hay.includes(ex))score=Math.max(score,55);return false;});
    return score?{id:w.id,term,score:Math.round(score)}:null;
  }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,5);
}
function ocrInboxRender(){
  const box=$('#ocrBatchList');if(!box)return;
  const all=ocrInboxRead();
  /* 先按笔记过滤，再按时间倒序（最新导入的排第一） */
  const list=all.filter(x=>!inboxFilterNoteId||x.noteId===inboxFilterNoteId)
    .slice().sort((a,b)=>(b.at||0)-(a.at||0));
  if(!list.length){
    box.innerHTML='<div class="ocr-tip">'+(inboxFilterNoteId?'这篇笔记没有待处理截图。':'收件箱为空。一次从相册多选截图后，这里会按识别结果给出候选词。')+'</div>';
    return;
  }
  const itemHtml=item=>{
    const cands=(item.candidates||[]);
    const chipsHtml=cands.length?cands.map(c=>'<button type="button" class="cand-chip" data-cand="'+esc(c.id)+'">'+esc(c.term)+'</button>').join(''):'<span class="cand-empty">没有候选词，在下面手动输入</span>';
    return '<div class="ocr-inbox-item" data-inbox-id="'+esc(item.id)+'"><img src="'+item.dataUrl+'" alt="待匹配截图"><div class="ocr-inbox-main"><textarea class="ocr-inbox-text" data-inbox-text rows="2" placeholder="识别文本，可手动修改">'+esc(item.text||'')+'</textarea><div class="cand-chips">'+chipsHtml+'</div><input data-inbox-term placeholder="手动输入新词，多个用逗号分隔"><div class="ocr-inbox-actions"><button class="mini-btn" data-inbox-confirm>确认匹配</button><button class="mini-btn danger" data-inbox-delete>删除</button></div></div></div>';
  };
  if(inboxFilterNoteId){
    /* 单笔记收件箱：不分组，直接按时间倒序列出 */
    const n=state.notes.find(x=>x.id===inboxFilterNoteId);
    box.innerHTML='<div class="inbox-group"><div class="inbox-group-title">'+esc(n?(n.title||'无标题'):'笔记')+'（'+list.length+'）</div>'+list.map(itemHtml).join('')+'</div>';
    return;
  }
  /* 总收件箱：按笔记分组，组内已按时间倒序；noteId 为空或笔记已删的归到「未分到笔记」 */
  const groups=[],gmap={};
  list.forEach(item=>{
    const n=item.noteId?state.notes.find(x=>x.id===item.noteId):null;
    const key=n?n.id:'__none__';
    if(!gmap[key]){const g={name:n?(n.title||'无标题'):'未分到笔记',items:[]};gmap[key]=g;groups.push(g);}
    gmap[key].items.push(item);
  });
  box.innerHTML=groups.map(g=>'<div class="inbox-group"><div class="inbox-group-title">'+esc(g.name)+'（'+g.items.length+'）</div>'+g.items.map(itemHtml).join('')+'</div>').join('');
}
function ocrInboxShow(){
  inboxFilterNoteId=null;
  $('#ocrSheet').classList.add('show');$('#ocrImgWrap').classList.add('hidden');$('#ocrSelected').classList.add('hidden');$('#ocrBatch').classList.remove('hidden');
  const st=$('#ocrStatus');if(st)st.textContent='批量收件箱：确认候选词后，截图会挂到对应词条。';ocrInboxRender();
}
/* 打开某篇笔记自己的收件箱（只看这篇笔记的待处理截图） */
function ocrInboxShowNote(noteId){
  inboxFilterNoteId=noteId||null;
  $('#ocrSheet').classList.add('show');$('#ocrImgWrap').classList.add('hidden');$('#ocrSelected').classList.add('hidden');$('#ocrBatch').classList.remove('hidden');
  const st=$('#ocrStatus');if(st)st.textContent='这篇笔记的待处理截图：确认后挂到对应词条。';ocrInboxRender();
}
/* 更新笔记编辑器顶部的"待处理 N 张"入口（正常流，不遮挡正文） */
function updateNoteInboxBar(){
  const bar=$('#noteInboxBar');
  if(!bar)return;
  if(ui.mode!=='edit'||!ui.note){ bar.classList.add('hidden'); return; }
  const n=ocrInboxRead().filter(x=>x.noteId===ui.note).length;
  const numEl=$('#noteInboxN'); if(numEl)numEl.textContent=String(n);
  bar.classList.toggle('hidden',n===0);
  if(!bar.__bound){
    const open=()=>ocrInboxShowNote(ui.note);
    bar.addEventListener('click',open);
    bar.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
    bar.__bound=true;
  }
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
    $('#ocrImgWrap').classList.add('hidden');$('#ocrSelected').classList.add('hidden');$('#ocrBatch').classList.add('hidden');
    $('#ocrStatus').textContent='';
    $('#ocrFolderPick').classList.remove('hidden');
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
