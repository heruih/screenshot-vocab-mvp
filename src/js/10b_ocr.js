let ocrShotQueue=Promise.resolve();
let ocrMountBusy=false;
let ocrSourceFile=null;
let ocrSingleNoteId=null;
let ocrBatchImporting=false;
const ocrReadRuns=new WeakMap();
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
async function ocrSaveMatches(targets,dataUrl,originalForTerm=()=> ''){
  const words=[];
  try{
    for(const term of targets){
      if(!await ocrAttachShot(term,dataUrl)) continue;
      const word=ocrEnsureWord(term);
      words.push(word);
      const original=originalForTerm(term);
      if(original&&!aMeta(word).original) aPut(word.id,{original});
    }
  }finally{if(words.length)save();}
  return words;
}
async function ocrConfirmInboxItems(ids,targets){
  const items=ocrInboxRead().filter(item=>ids.includes(item.id)&&!ocrInboxBusy.has(item.id));
  if(!items.length)return;
  const rows=new Map(Array.from($('#ocrBatchList').querySelectorAll('[data-inbox-id]')).map(row=>[row.dataset.inboxId,row]));
  const controls=items.flatMap(item=>Array.from(rows.get(item.id)?.querySelectorAll('button,input,textarea')||[]));
  items.forEach(item=>ocrInboxBusy.add(item.id));
  controls.forEach(control=>control.disabled=true);
  let completed=0,lastResult=null;
  try{
    for(const item of items){
      try{
        const row=rows.get(item.id);
        const dataUrl=ocrSavedImage(row,item.dataUrl);
        const original=term=>row?ocrTermOriginal(row,term):item.text||'';
        if(firstShotCommercial()){
          let nid=item.noteId;
          if(!state.notes.some(note=>note.id===nid)){
            nid=await pickNoteForImport();
            ocrShowPanel('inbox');
            if(!nid)break;
          }
          lastResult=await importShotToNote(nid,targets,dataUrl,original);
        }else{
          const words=await ocrSaveMatches(targets,dataUrl,original);
          if(words.length!==targets.length)continue;
        }
        await inboxRemoveItem(item.id);
        ocrDiscardDraft(item.id);
        ocrRemoveInboxRow(row);
        completed++;
      }catch(_){ /* Retain the source image, including on a partially saved match. */ }
    }
    render();
    const remaining=items.length-completed;
    if(!remaining&&lastResult){ocrCloseSheet();showImportedNote(lastResult);return;}
    if(remaining)toast('已完成 '+completed+' 张，另有 '+remaining+' 张留在收件箱，可重试','warn');
    else toast(items.length===1?'已挂到 '+targets.length+' 个词条':'已将 '+completed+' 张截图挂到「'+targets[0]+'」','ok');
  }finally{
    items.forEach(item=>ocrInboxBusy.delete(item.id));
    controls.forEach(control=>control.disabled=false);
  }
}
function ocrInboxConfirm(row){
  const targets=ocrMatchTargets(row);
  if(!targets.length){toast('请先选择或输入要匹配的词条','warn');return;}
  if(firstOwnImporting&&targets.length!==1){toast('这次先选一个表达来练。','warn');return;}
  return ocrConfirmInboxItems([row.dataset.inboxId],targets);
}
async function ocrBatchConfirm(){
  const area=$('#ocrBatchMatch'),button=$('#ocrBatchConfirm');
  if(button.disabled)return;
  const ids=ocrInboxSelection(),targets=ocrMatchTargets(area);
  if(targets.length!==1){toast('请为这批截图选一个词条','warn');return;}
  button.disabled=true;
  try{await ocrConfirmInboxItems(ids,targets);}
  finally{button.disabled=false;}
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
async function ocrInboxDelete(row){
  const id=row.dataset.inboxId;
  if(ocrInboxBusy.has(id))return;
  ocrInboxBusy.add(id);
  try{await inboxRemoveItem(id);ocrDiscardDraft(id);ocrRemoveInboxRow(row);updateNoteInboxBar();toast('已删除这张截图','ok');}
  catch(_){toast('删除失败，截图仍在收件箱','warn');}
  finally{ocrInboxBusy.delete(id);}
}
async function ocrImportBatch(files,noteId){
  inboxFilterNoteId=noteId||null;
  const targetNote=state.notes.find(n=>n.id===noteId);
  const folderId=targetNote?targetNote.folderId:'';
  $('#ocrSheet').classList.add('show');
  ocrShowPanel('inbox');
  const st=$('#ocrInboxStatus');
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
        while(ocrRecognition) await ocrWait(ocrRecognition.catch(()=>{}),15000,'上一张识别超时');
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
      close.addEventListener('click',ocrCloseSheet);
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
    ocrEngineLoading=import(base+'ocr-engine-region-v1.mjs').catch(()=>import(base+'ocr-engine.mjs')).then(async mod=>{
      await mod.init({wasmPaths:base+'ort/',modelBase:base+'models/'});
      ocrEngineMod=mod;
      return mod;
    }).finally(()=>{ocrEngineLoading=null;});
  }
  return ocrWait(ocrEngineLoading,30000,'识别组件加载超时');
}
function recognizeOcrPhoto(file,allRows=false){
  if(ocrRecognition)throw new Error('上一张仍在识别，稍后可重试');
  if(allRows&&!ocrEngineMod.recognizeWholeImage)throw new Error('识别组件缺少整图或框选功能，请刷新后重试');
  ocrRecognition=(async()=>{
    const blobUrl=await recognitionUrlFor(file);
    try{return allRows?await ocrEngineMod.recognizeWholeImage(blobUrl):await ocrEngineMod.recognize(blobUrl);}
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
function ocrResetSingle(){
  ocrDataUrl='';
  ocrSourceFile=null;
  ocrSingleNoteId=null;
  ocrDiscardDraft();
  $('#ocrImg').removeAttribute('src');
  $('#ocrChooseFile').hidden=false;
  $('#ocrStatus').textContent='';
  $('#ocrImgWrap').classList.add('hidden');
  $('#ocrSelected').classList.add('hidden');
  $('#ocrEdit').value='';
  const editor=$('#ocrEdit').closest('details');
  editor.open=false;
  editor.hidden=true;
  $('#ocrTerm').value='';
  $('#ocrSelected [data-ocr-matches]').replaceChildren();
  $('#ocrSelected [data-ocr-picker]')?.remove();
  $('#ocrImgWrap [data-ocr-frame]').textContent='框选区域';
  $('#ocrImgWrap [data-ocr-restore]').hidden=true;
  $('#ocrImgWrap [data-ocr-crop-note]').hidden=true;
  $('#ocrMount').textContent='保存表达';
}
function ocrCloseSheet(){
  firstOwnResetImport();
  ++ocrImportVersion;
  $('#ocrSheet').classList.remove('show');
  if(!$('#ocrFolderPick').classList.contains('hidden')) $('#ocrFolderCancel').click();
  ocrResetSingle();
  ocrShowPanel('import');
}

async function ocrRecognizeMatchArea(area,source,framed){
  if(!source) return;
  const rowId=area.dataset.inboxId;
  if(rowId?ocrInboxBusy.has(rowId):ocrMountBusy) return;
  const version=ocrImportVersion,job={};
  const status=rowId?area.querySelector('[data-ocr-row-status]'):$('#ocrStatus');
  const edit=area.querySelector('[data-ocr-text]'),before=edit.value;
  const current=()=>ocrImportVersion===version&&ocrReadRuns.get(area)===job&&area.isConnected&&
    $('#ocrSheet').classList.contains('show')&&!(rowId?ocrInboxBusy.has(rowId):ocrMountBusy);
  ocrReadRuns.set(area,job);
  try{
    status.textContent=ocrEngineMod?'正在等待识别…':'正在加载识别组件…';
    await loadOcrEngine();
    // 和批量导入共用识别器，避免手机同时为多张图解码和推理。
    while(ocrRecognition&&current()){
      await ocrWait(ocrRecognition.catch(()=>{}),15000,'上一张仍在识别，请稍后重试');
    }
    if(!current()) return;
    status.textContent=framed?'正在识别框内文字…':'正在识别整张图…';
    const text=await recognizeOcrPhoto(source,true);
    if(!current()) return;
    if(!text?.trim()){
      status.textContent='这里没读到清楚的英文，可以重框或手动输入。';
      return;
    }
    if(edit.value!==before){
      status.textContent='保留了你刚编辑的文字，可重新识别。';
      return;
    }
    edit.value=text;
    ocrRenderMatchArea(area);
    if(firstOwnImporting&&!rowId)firstGuideTarget('ownWord');
    if(framed) ocrImageControls(area).querySelector('[data-ocr-frame]').textContent='再框一块';
    if(rowId) await ocrRememberInboxText(area,text);
    if(current()) status.textContent='';
  }catch(error){
    if(current()) status.textContent=(error.message||'识别失败')+'。可重试或手动输入，已选表达保留。';
  }
}

async function ocrImportImage(event,tutorial=false){
  const input=event.currentTarget;
  const files=Array.from(input.files||[]);
  input.value='';
  if(!files.length) return;
  if(files.length>1&&ocrBatchImporting){
    toast('这一批还在导入，可先处理单张截图。','warn');
    return;
  }
  const own=tutorial==='own'||(!tutorial&&files.length===1&&!firstOwnDraft&&firstOwnOffered());
  const version=++ocrImportVersion;
  ocrResetSingle();
  firstOwnImporting=own;
  let noteId=null;
  if(own&&ui.mode==='edit'&&state.notes.some(n=>n.id===ui.note)){
    noteId=ui.note;
  }else if(own){
    const picked=pickNoteForImport({created(){}});
    firstGuideTarget(state.notes.length?'ownExisting':'ownNote');
    noteId=await picked;
    if(version!==ocrImportVersion)return;
    if(!noteId){ocrCloseSheet();return;}
  }else if(tutorial){
    noteId=await firstGuidePickNote();
    if(version!==ocrImportVersion||!noteId)return;
  }else if(firstShotCommercial()||files.length>1){
    noteId=ui.mode==='edit' && state.notes.some(n=>n.id===ui.note) ? ui.note : await pickNoteForImport();
    if(version!==ocrImportVersion)return;
    if(!noteId){ocrShowPanel('import');return;}
  }
  ocrSingleNoteId=noteId;
  if(files.length>1){
    ocrBatchImporting=true;
    try{await ocrImportBatch(files,noteId);}
    finally{ocrBatchImporting=false;}
    return;
  }
  const f=files[0];
  ocrShowPanel('import');
  $('#ocrChooseFile').hidden=true;
  const st=$('#ocrStatus'); if(st) st.textContent='正在读取截图…';
  $('#ocrSheet').classList.add('show');
  try{
    const dataUrl=await ocrWait(shotCompress(f),10000,'图片读取超时');
    if(version!==ocrImportVersion)return;
    ocrDataUrl=dataUrl;
    ocrSourceFile=f;
    $('#ocrImg').src=dataUrl;
    $('#ocrImgWrap').classList.remove('hidden');
    $('#ocrSelected').classList.remove('hidden');
    if(st)st.textContent='点图查看大图，或选择识别整图／框选。';
    if(own)firstGuideTarget('ownPreview');
    else if(tutorial)firstGuidePreview();
  }catch(e){
    if(own)firstOwnResetImport();
    else if(tutorial)throw e;
    console.error('截图压缩失败',e);
    if(version===ocrImportVersion){
      $('#ocrChooseFile').hidden=false;
      if(st)st.textContent='图片读取失败，请重新选择截图。';
    }
    return;
  }
}
async function ocrMount(){
  if(ocrMountBusy)return;
  if(!ocrDataUrl){toast('先选一张截图','warn');return;}
  const area=$('#ocrSelected'),targets=ocrMatchTargets(area);
  if(!targets.length){toast('请先选择或输入要匹配的词条','warn');return;}
  if(firstOwnImporting&&targets.length!==1){toast('这次先选一个表达来练。','warn');return;}
  const dataUrl=ocrSavedImage(area,ocrDataUrl),version=ocrImportVersion,button=$('#ocrMount');
  const originals=new Map(targets.map(term=>[term,ocrTermOriginal(area,term)]));
  ocrMountBusy=true;button.disabled=true;
  try{
    if(firstShotCommercial()){
      const sample=firstGuideStep==='shotSave';
      const result=await importShotToNote(ocrSingleNoteId,targets,dataUrl,term=>originals.get(term),sample);
      if(ocrImportVersion!==version)return;
      const own=firstOwnImporting;
      ocrCloseSheet();
      if(own){firstOwnAttach(result,originals.get(result?.word.term));return;}
      if(sample&&result){firstGuideShotSaved(result.word);firstShotOpenCard();return;}
      if(targets.length===1&&result){
        render();
        openWordModal(result.word.term,null,null,result.word);
      }else showImportedNote(result);
      return;
    }
    const words=await ocrSaveMatches(targets,dataUrl,term=>originals.get(term));
    if(ocrImportVersion!==version)return;
    if(words.length!==targets.length){toast('部分词条的截图空间已满，可调整后重试','warn');return;}
    ocrCloseSheet();
    render();
    if(words.length===1)openWordModal(words[0].term,null,null,words[0]);
    toast(words.length===1?'截图已挂到「'+words[0].term+'」':'截图已挂到 '+words.length+' 个词条','ok');
  }catch(error){
    toast(error.message||'截图保存失败，请重试','warn');
  }finally{
    ocrMountBusy=false;button.disabled=false;
  }
}

