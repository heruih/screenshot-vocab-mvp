let ocrShotQueue=Promise.resolve();
let ocrMountBusy=false;
const ocrInboxBusy=new Set();
function ocrAttachShot(term,dataUrl){
  const write=ocrShotQueue.then(async()=>{
    const attachCap=await shotCapacity();
    const all=shotsAll(),key=shotsKeyOf(term),list=all[key]||[];
    if(list.some(shot=>shot.dataUrl===dataUrl)) return true;
    if(list.length>=SHOT_MAX_PER_WORD||shotsTotal(all)>=attachCap) return false;
    const next={...all,[key]:[...list,{id:uid(),dataUrl,at:Date.now()}]};
    if(shotUseIdb){
      const db=await idbOpen();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(IDB_STORE_SHOTS,'readwrite');
        tx.oncomplete=resolve;
        tx.onabort=()=>reject(tx.error||new Error('截图保存失败'));
        tx.objectStore(IDB_STORE_SHOTS).put(next,'all');
      });
    }
    else if(!aStore(SHOTS_KEY,JSON.stringify(next))) throw new Error('截图保存失败');
    if(shotReady) shotCache=next;
    return true;
  });
  ocrShotQueue=write.catch(()=>{});
  return write;
}
async function ocrInboxConfirm(id){
  if(ocrInboxBusy.has(id)) return;
  const list=ocrInboxRead(),item=list.find(x=>x.id===id);if(!item)return;
  const row=Array.from(document.querySelectorAll('[data-inbox-id]')).find(el=>el.dataset.inboxId===id);
  if(!row)return;
  /* 选中的候选词（可多个）+ 手动输入（逗号/顿号分隔，可多个） */
  const candIds=Array.from(row.querySelectorAll('[data-cand].on')).map(b=>b.dataset.cand);
  const manualTerms=(row.querySelector('[data-inbox-term]')?.value||'').split(/[,，、;；]/).map(s=>s.trim()).filter(Boolean);
  const targets=[];const seen=new Set();
  candIds.forEach(cid=>{
    const w=state.words.find(x=>x.id===cid);
    if(w&&!seen.has(ocrNorm(w.term))){seen.add(ocrNorm(w.term));targets.push(w.term);}
  });
  manualTerms.forEach(term=>{
    const key=ocrNorm(term);
    if(seen.has(key)) return;
    seen.add(key);
    const w=state.words.find(x=>ocrNorm(x.term)===key);
    targets.push(w?w.term:term);
  });
  if(!targets.length){toast('先点候选词，或手动输入至少一个词','warn');return;}
  const controls=row.querySelectorAll('button');
  ocrInboxBusy.add(id);
  controls.forEach(button=>button.disabled=true);
  try{
    let saved=0;
    const failed=[];
    for(const term of targets){
      if(!await ocrAttachShot(term,item.dataUrl)){
        failed.push(term);
        continue;
      }
      ocrEnsureWord(term);
      saved++;
    }
    save();
    if(failed.length){
      toast('「'+failed.join('、')+'」截图已满，待匹配原图仍在收件箱','warn');
      return;
    }
    await inboxRemoveItem(id);
    render();ocrInboxRender();
    toast('已挂到 '+saved+' 个词','ok');
  }catch(_){
    toast('截图保存未完成，原图仍在收件箱，可重试','warn');
  }finally{
    ocrInboxBusy.delete(id);
    controls.forEach(button=>button.disabled=false);
  }
}
function ocrEnsureWord(term){
  const existing=state.words.find(w=>w.term.toLowerCase()===term.toLowerCase());
  if(existing) return existing;
  const word=upsertWord({term,definition:'',examples:[],collocations:[],tags:[],source:'shot',notes:[],mastered:false});
  try{ aPut(word.id,{stage:'pending'}); }
  catch(err){
    state.words.splice(state.words.indexOf(word),1);
    throw err;
  }
  return word;
}
async function ocrInboxDelete(id){await inboxRemoveItem(id);ocrInboxRender();toast('已删除这张截图','ok');}
async function ocrImportBatch(files,noteId){
  const targetNote=state.notes.find(n=>n.id===noteId);
  const folderId=targetNote?targetNote.folderId:'';
  $('#ocrSheet').classList.add('show');$('#ocrImgWrap').classList.add('hidden');$('#ocrSelected').classList.add('hidden');$('#ocrBatch').classList.remove('hidden');
  const st=$('#ocrStatus');
  /* 进度条：批量开始即显示；完成卡片先隐藏 */
  const prog=$('#ocrProgress'),doneCard=$('#ocrDoneCard'),pFill=$('#ocrProgressFill'),pText=$('#ocrProgressText'),pPct=$('#ocrProgressPct');
  if(prog)prog.classList.remove('hidden');
  if(doneCard)doneCard.classList.add('hidden');
  const setProgress=n=>{
    const pct=Math.round((n/files.length)*100);
    if(pFill)pFill.style.width=pct+'%';
    if(pPct)pPct.textContent=pct+'%';
    if(pText)pText.textContent='正在导入 '+n+' / '+files.length+' 张';
  };
  setProgress(0);
  /* 动态配额：IDB 模式按真实剩余空间算可存张数，不再写死 2000；LS 模式按剩余字节 */
  const shotCap=inboxUseIdb?await shotCapacity():0;
  if(inboxUseIdb){
    const curN=shotsTotal(shotsAll())+(inboxCache?inboxCache.length:0);
    if(st)st.textContent='正在处理 '+files.length+' 张截图…按当前剩余空间预计还可存约 '+shotCap+' 张，当前已有 '+curN+' 张（每处理一张就保存，可随时关闭）';
  }else{
    const pre=storageQuote();
    if(st)st.textContent='正在处理 '+files.length+' 张截图…当前剩余空间约 '+fmtBytes(pre.free)+'（每处理一张就保存，可随时关闭）';
  }
  let list=ocrInboxRead();
  /* 识别组件加载失败也不阻断：先把图存下来，稍后在收件箱手动匹配 */
  let ocrReady=true;
  if(st)st.textContent='正在加载识别组件，首次下载可能需要一些时间…';
  try{await loadOcrEngine();}catch(e){ocrReady=false;if(st)st.textContent=e.message+'，截图将先保存，可在收件箱手动匹配。';}
  let saved=0, unreadable=0, unrecognized=0, estAvg=0;
  for(let i=0;i<files.length;i++){
    let dataUrl='',text='',candidates=[];
    try{
      dataUrl=await ocrWait(shotCompress(files[i]),10000,'图片读取超时');
    }catch(_){unreadable++;continue;}
    if(ocrReady){
      if(st)st.textContent='正在识别第 '+(i+1)+' / '+files.length+' 张，已保存 '+saved+' 张…';
      try{
        text=await recognizeOcrPhoto(files[i]);
        candidates=ocrCandidates(text);
      }catch(_){text='';}
    }
    if(!text)unrecognized++;
    /* 写入前容量预检：
       IDB 模式按动态配额（真实剩余空间）控制；
       LS 回退模式才按字节配额提前停止，不触发 setItem 异常。 */
    const itemBytes=byteLen(dataUrl)+128;
    if(inboxUseIdb){
      if(shotsTotal(shotsAll())+list.length+1>shotCap){
        if(st)st.textContent='剩余空间将满：已保存 '+saved+' 张，剩余 '+(files.length-i)+' 张未导入。可先导出备份或清理后再导入。';
        toast('截图库剩余空间不足，已停止导入','warn');
        if(prog)prog.classList.add('hidden');
        ocrInboxRender();
        return;
      }
    }else if(storageUsedBytes()+itemBytes>LS_QUOTA){
      if(st)st.textContent='空间将满：已保存 '+saved+' 张，剩余 '+(files.length-i)+' 张未导入。请先在设置查看占用、整理或导出备份。';
      toast('剩余空间不够再存一张，已停止导入','warn');
      if(prog)prog.classList.add('hidden');
      ocrInboxRender();
      return;
    }
    const item={id:uid(),dataUrl,text,candidates,noteId:noteId||'',folderId:folderId||'',at:Date.now(),status:'pending'};
    /* 处理一张只写这一条（O(1)，不再整体重写）；失败回退这一条并停止 */
    try{
      await inboxPutItem(item);
      saved++;
      setProgress(saved);
      estAvg=estAvg?Math.round((estAvg+itemBytes)/2):itemBytes;
      const canMore=inboxUseIdb
        ? Math.max(0,shotCap-shotsTotal(shotsAll())-inboxCache.length)
        : (estAvg?Math.floor(storageQuote().free/estAvg):0);
      if(st)st.textContent='已保存 '+(i+1)+' / '+files.length+' 张 · 预计还能存约 '+canMore+' 张（可随时关闭，已存的不会丢）';
    }catch(writeErr){
      await inboxRemoveItem(item.id);
      if(st)st.textContent='存储失败：已保存 '+saved+' 张，剩余 '+(files.length-i-1)+' 张未导入。请先整理或导出备份。';
      toast('收件箱写入失败，先处理已存截图','warn');
      if(prog)prog.classList.add('hidden');
      ocrInboxRender();
      return;
    }
  }
  ocrInboxRender();
  if(prog)prog.classList.add('hidden');
  if(doneCard){
    const sub=$('#ocrDoneSub');
    if(sub)sub.textContent='已导入 '+saved+' 张到《'+(targetNote?(targetNote.title||'无标题'):'未分笔记')+'》';
    doneCard.classList.remove('hidden');
    const proc=$('#ocrDoneProcess'),close=$('#ocrDoneClose');
    if(proc&&!proc.__bound){
      proc.addEventListener('click',()=>{
        doneCard.classList.add('hidden');
        const lbl=$('#ocrBatchLabel'); if(lbl)lbl.scrollIntoView({block:'start'});
      });
      proc.__bound=true;
    }
    if(close&&!close.__bound){
      close.addEventListener('click',()=>{ $('#ocrSheet').classList.remove('show'); });
      close.__bound=true;
    }
  }
  if(st&&(unrecognized||unreadable))st.textContent='已保存 '+saved+' 张。'+
    (unrecognized?' '+unrecognized+' 张未识别到文字，可在收件箱手动匹配。':'')+
    (unreadable?' '+unreadable+' 张读取失败，可重新选图。':'');
}
let ocrEngineMod=null, ocrEngineLoading=null, ocrImportVersion=0, ocrRecognition=null;
function ocrWait(task,ms,message){
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);});
  return Promise.race([task,deadline]).finally(()=>clearTimeout(timer));
}
/* 动态 import 独立 PP-OCR 引擎并初始化（外部资源位于 ocr-assets/，单 HTML 不内联模型） */
async function loadOcrEngine(){
  if(ocrEngineMod) return ocrEngineMod;
  if(!CAP.ocr) throw new Error('当前浏览器不支持本地识别（需较新系统：iOS 16.4+ 或 Chrome 91+）');
  if(!ocrEngineLoading){
    const base=new URL('ocr-assets/', document.baseURI).href;
    ocrEngineLoading=import(base+'ocr-engine.mjs').then(async mod=>{
      await mod.init({wasmPaths:base+'ort/',modelBase:base+'models/'});
      ocrEngineMod=mod;
      return mod;
    }).finally(()=>{ocrEngineLoading=null;});
  }
  return ocrWait(ocrEngineLoading,30000,'识别组件加载超时');
}
function recognizeOcrPhoto(file){
  if(ocrRecognition)throw new Error('上一张仍在识别，稍后可重试');
  ocrRecognition=(async()=>{
    const blobUrl=await recognitionUrlFor(file);
    try{return await ocrEngineMod.recognize(blobUrl);}
    finally{URL.revokeObjectURL(blobUrl);}
  })().finally(()=>{ocrRecognition=null;});
  return ocrWait(ocrRecognition,15000,'本张截图识别超时');
}
/* 识别用最大边：超过就等比缩小，控制 iPhone 全尺寸处理的内存峰值；小于限制的图原样用 */
const RECOGNIZE_MAX_EDGE=1920;
function recognitionUrlFor(file){
  const srcUrl=URL.createObjectURL(file);
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      let w=img.naturalWidth,h=img.naturalHeight;
      if(Math.max(w,h)<=RECOGNIZE_MAX_EDGE){ resolve(srcUrl); return; }
      const ratio=RECOGNIZE_MAX_EDGE/Math.max(w,h);
      w=Math.max(1,Math.round(w*ratio));h=Math.max(1,Math.round(h*ratio));
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      try{
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        canvas.toBlob(blob=>blob?resolve(URL.createObjectURL(blob)):reject(new Error('截图缩放失败')),'image/jpeg',0.9);
      }catch(e){reject(e);}
      finally{URL.revokeObjectURL(srcUrl);}
    };
    img.onerror=()=>{ URL.revokeObjectURL(srcUrl); reject(new Error('image load error')); };
    img.src=srcUrl;
  });
}
function ocrStopWords(){
  return new Set(['the','and','for','with','that','this','from','have','has','had','you','your','are','was','were','not','but','what','when','where','who','why','how','all','can','will','just','like','about','into','out','over','again','then','than','them','they','their','there','here','because','very','really','much','more','most','some','any','get','got','going','go','goes','been','being','would','could','should','shall','may','might','must','do','does','did','done','is','it','its','i','he','she','we','on','in','at','to','of','a','an','so','if','or','as','up','down','off','no','yes','ok','okay','oh','yeah','wanna','gonna','know','knows','say','says','said','see','saw','seen','look','looks','think','thinks','thought','want','wants','need','needs','make','makes','made','take','takes','took','come','comes','came','right','good','bad','day','days','time','times','thing','things','one','two','three','new','now','us','im','ive','ill','dont','cant','didnt','wont','isnt','wasnt','werent','arent','youre','hes','shes','theyre','whats','thats','its','guys','guy','girl','boy','people','person','man','woman','men','women','kids','child','children','home','house','work','works','way','ways','lot','lots','little','big','long','short','well','really','actually','pretty','quite','very']);
}
async function ocrImportImage(event){
  const input=event.currentTarget;
  const files=Array.from(input.files||[]);
  input.value='';
  if(!files.length) return;
  const version=++ocrImportVersion;
  if(files.length>1){
    const noteId=await pickNoteForImport();
    if(!noteId)return;
    await ocrImportBatch(files,noteId);
    return;
  }
  const f=files[0];
  ocrSel=[]; ocrDataUrl=''; ocrWords=[];
  $('#ocrBoxes').innerHTML='';
  $('#ocrImg').src='';
  $('#ocrImgWrap').classList.add('hidden');
  $('#ocrSelected').classList.add('hidden');
  $('#ocrBatch').classList.add('hidden');
  $('#ocrWordChips')?.remove();
  const ed=$('#ocrEdit'); if(ed) ed.value='';
  const st=$('#ocrStatus'); if(st) st.textContent='正在读取截图…';
  $('#ocrSheet').classList.add('show');
  try{
    const dataUrl=await ocrWait(shotCompress(f),10000,'图片读取超时');
    if(version!==ocrImportVersion)return;
    ocrDataUrl=dataUrl;
    $('#ocrImg').src=dataUrl;
    $('#ocrImgWrap').classList.remove('hidden');
    $('#ocrSelected').classList.remove('hidden');
    $('#ocrBoxes').innerHTML=''; // PP-OCR 无词级坐标，不再在图上叠词框
  }catch(e){
    console.error('截图压缩失败',e);
    if(st&&version===ocrImportVersion)st.textContent='图片读取失败，请重新选择截图。';
    return;
  }
  /* 识别+渲染 chips 单独成函数，失败可点重试，不用重新选图/压缩 */
  const runRecognize=async ()=>{
    if(st) st.textContent=ocrEngineMod?'正在识别截图…':'正在加载识别组件，首次下载可能需要一些时间…';
    await loadOcrEngine();
    if(version!==ocrImportVersion)return;
    if(st) st.textContent='正在识别截图…';
    const sentence=await recognizeOcrPhoto(f);
    if(version!==ocrImportVersion||!ocrDataUrl)return;
    if(!sentence){
      if(st) st.textContent='底部未识别到清楚的英文，可直接在下方输入完整表达并保存截图。';
      return;
    }
    ocrWords=sentence.split(/\s+/).map(t=>t.replace(/[^A-Za-z']/g,'')).filter(Boolean);
    // 重建横排可点单词（默认全选，点一下从整句移除，再点加回）
    const oldChips=$('#ocrWordChips'); if(oldChips) oldChips.remove();
    const chips=document.createElement('div');
    chips.id='ocrWordChips'; chips.className='cand-chips';
    chips.innerHTML=ocrWords.map((w,i)=>'<button type="button" class="cand-chip on" data-wi="'+i+'">'+esc(w)+'</button>').join('');
    $('#ocrSelected').insertBefore(chips,ed);
    ed.value=sentence;
    chips.addEventListener('click',e=>{
      const b=e.target.closest('.cand-chip'); if(!b) return;
      b.classList.toggle('on');
      // 按原始顺序，根据每个 chip 的选中状态重建整句，保证加回时词序不乱
      ed.value=Array.from(chips.querySelectorAll('.cand-chip'))
        .filter(c=>c.classList.contains('on'))
        .map(c=>ocrWords[Number(c.dataset.wi)])
        .join(' ');
    });
    if(st) st.textContent='识别到整句：默认整句，点单词可移除/加回，也可直接在下方编辑';
  };
  const attachRetry=()=>{ const rb=$('#ocrRetry'); if(rb) rb.addEventListener('click',doRetry); };
  const showFail=err=>{
    if(!st||version!==ocrImportVersion||!ocrDataUrl) return;
    if(!CAP.ocr){
      st.textContent='当前浏览器不支持自动识别（需 iOS 16.4+ 或 Chrome 91+），可在下方手动输入完整表达并保存截图。';
      return;
    }
    st.innerHTML='识别暂不可用（'+esc((err&&err.message)||'未知错误')+'）。可在下方手动输入，或 <button type="button" class="link-btn" id="ocrRetry">重试识别</button>';
    attachRetry();
  };
  const doRetry=async ()=>{
    try{ await runRecognize(); }
    catch(e2){ console.error('重试仍失败',e2); showFail(e2); }
  };
  try{
    await runRecognize();
  }catch(e){
    console.error('单图识别失败',e);
    showFail(e);
  }
}
async function ocrMount(){
  if(ocrMountBusy) return;
  const ed=$('#ocrEdit');
  const text=ed?ed.value.trim():'';
  if(!ocrDataUrl){ toast('先选一张截图','warn'); return; }
  if(!text){ toast('先点词框选中，或直接输入单词/短语','warn'); return; }
  const dataUrl=ocrDataUrl,button=$('#ocrMount');
  ocrMountBusy=true;
  button.disabled=true;
  try{
    if(!await ocrAttachShot(text,dataUrl)){
      toast('截图空间已满，本次选图已保留','warn');
      return;
    }
    const word=ocrEnsureWord(text);
    save();
    if(ocrDataUrl!==dataUrl) return;
    $('#ocrSheet').classList.remove('show');
    ocrDataUrl=''; ocrSel=[]; ocrWords=[];
    ed.value='';
    $('#ocrBoxes').innerHTML=''; $('#ocrImg').src='';
    $('#ocrImgWrap').classList.add('hidden'); $('#ocrSelected').classList.add('hidden');
    render();
    openWordModal(word.term,null,null,word);
    toast('截图已保存到「'+word.term+'」','ok');
  }catch(_){
    toast('截图保存失败，请重试','warn');
  }finally{
    ocrMountBusy=false;
    button.disabled=false;
  }
}

