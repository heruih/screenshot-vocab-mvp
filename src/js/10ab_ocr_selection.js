/* 大图预览和收词草稿。框选以原图比例保存，缩放不会改变识别范围。 */
let ocrImageView=null;
const ocrTermDrafts=new Map();

function ocrDraftFor(area){
  const key=area.dataset.inboxId||'single';
  if(!ocrTermDrafts.has(key)) ocrTermDrafts.set(key,{picks:new Map(),anchor:null,end:null,inputSpan:null,text:null});
  return ocrTermDrafts.get(key);
}
function ocrDiscardDraft(key='single'){
  ocrTermDrafts.delete(key);
}
function ocrSelectionHtml(){
  return '<div data-ocr-picker hidden>'+
    '<strong class="ocr-match-label" data-ocr-pick-title>从图里选词</strong>'+
    '<div class="ocr-token-list" data-ocr-tokens aria-label="可选识别文字"></div>'+
    '<div class="ocr-picker-actions"><small data-ocr-selection-hint></small>'+
    '<button class="mini-btn" type="button" data-ocr-add-selected disabled>加入已选</button></div>'+
    '<div class="ocr-picked-list" data-ocr-picked></div>'+
    '</div>';
}
function ocrRenderTermPicker(area){
  const field=area.querySelector('[data-ocr-text]');
  if(!field) return;
  const editor=field.closest('details');
  let picker=area.querySelector('[data-ocr-picker]');
  if(!picker){
    editor.insertAdjacentHTML('beforebegin',ocrSelectionHtml());
    picker=area.querySelector('[data-ocr-picker]');
  }
  const draft=ocrDraftFor(area);
  const text=field.value;
  editor.hidden=!text.trim()&&!editor.open;
  if(draft.text!==text||!picker.dataset.ready){
    draft.text=text;
    draft.anchor=draft.end=draft.inputSpan=null;
    picker.dataset.ready='1';
    let html='',offset=0;
    for(const token of text.matchAll(/[A-Za-z0-9]+(?:[’'-][A-Za-z0-9]+)*/g)){
      const start=token.index,end=start+token[0].length;
      html+=esc(text.slice(offset,start))+'<button class="ocr-token" type="button" data-ocr-token="'+start+'" data-ocr-end="'+end+'" aria-pressed="false">'+esc(token[0])+'</button>';
      offset=end;
    }
    picker.querySelector('[data-ocr-tokens]').innerHTML=html+esc(text.slice(offset));
  }
  ocrRefreshTermPicker(area);
}
function ocrSelectedSpan(area){
  const draft=ocrDraftFor(area),field=area.querySelector('[data-ocr-text]');
  if(field.selectionEnd>field.selectionStart&&document.activeElement===field){
    return [field.selectionStart,field.selectionEnd];
  }
  return draft.anchor===null?draft.inputSpan:[draft.anchor,draft.end];
}
function ocrRefreshTermPicker(area){
  const picker=area.querySelector('[data-ocr-picker]');
  if(!picker) return;
  const draft=ocrDraftFor(area);
  const hasText=!!draft.text?.trim();
  picker.hidden=!hasText&&!draft.picks.size;
  picker.querySelector('[data-ocr-pick-title]').hidden=!hasText;
  picker.querySelector('[data-ocr-tokens]').hidden=!hasText;
  picker.querySelector('.ocr-picker-actions').hidden=!hasText;
  const span=ocrSelectedSpan(area);
  picker.querySelectorAll('[data-ocr-token]').forEach(button=>{
    const included=span&&Number(button.dataset.ocrToken)>=span[0]&&Number(button.dataset.ocrEnd)<=span[1];
    button.setAttribute('aria-pressed',String(!!included));
  });
  picker.querySelector('[data-ocr-add-selected]').disabled=!span;
  picker.querySelector('[data-ocr-selection-hint]').textContent=span
    ? '选中「'+draft.text.slice(...span).trim()+'」'
    : '点一个词；选短语可点首尾两个词。';
  picker.querySelector('[data-ocr-picked]').innerHTML=draft.picks.size
    ? '<small>已选 '+draft.picks.size+' 个</small>'+Array.from(draft.picks,([key,pick])=>
      '<button class="mini-btn ocr-picked-term" type="button" data-ocr-unpick="'+esc(key)+'" aria-label="移除 '+esc(pick.term)+'">'+esc(pick.term)+' ×</button>'
    ).join('')
    : '';
  const count=ocrMatchTargets(area).length;
  const saveButton=area.querySelector('#ocrMount,[data-inbox-confirm]');
  if(saveButton) saveButton.textContent=count?'保存 '+count+' 个表达':'保存表达';
}
function ocrPickToken(area,button){
  const draft=ocrDraftFor(area);
  const field=area.querySelector('[data-ocr-text]');
  if(field.selectionStart!==field.selectionEnd) field.setSelectionRange(field.selectionEnd,field.selectionEnd);
  draft.inputSpan=null;
  const start=Number(button.dataset.ocrToken),end=Number(button.dataset.ocrEnd);
  if(draft.anchor===null||draft.extended){
    draft.anchor=start;
    draft.end=end;
    draft.extended=false;
  }else{
    draft.anchor=Math.min(draft.anchor,start);
    draft.end=Math.max(draft.end,end);
    draft.extended=true;
  }
  ocrRefreshTermPicker(area);
}
function ocrOriginalForSpan(text,start,end){
  const boundary=/[.!?。！？](?=\s|$)|\n/g;
  const previous=Array.from(text.slice(0,start).matchAll(boundary)).at(-1);
  const next=boundary.exec(text.slice(end));
  return text.slice(previous?previous.index+1:0,next?end+next.index+1:text.length).trim();
}
function ocrAddSelectedTerm(area){
  const span=ocrSelectedSpan(area);
  if(!span) return;
  const draft=ocrDraftFor(area),text=area.querySelector('[data-ocr-text]').value;
  const term=text.slice(...span).trim().replace(/\s+/g,' ');
  if(!ocrNorm(term)) return;
  draft.picks.set(ocrNorm(term),{term,original:ocrOriginalForSpan(text,...span)});
  draft.anchor=draft.end=draft.inputSpan=null;
  const field=area.querySelector('[data-ocr-text]');
  field.setSelectionRange(span[1],span[1]);
  ocrRefreshTermPicker(area);
}
function ocrTermOriginal(area,term){
  const pick=ocrDraftFor(area).picks.get(ocrNorm(term));
  return pick?.original||area.querySelector('[data-ocr-text]')?.value.trim()||'';
}

function ocrPreviewSource(area){
  return ocrDraftFor(area).crop?.source||
    (area.id==='ocrSelected'?ocrSourceFile:ocrInboxRead().find(item=>item.id===area.dataset.inboxId)?.dataUrl);
}
function ocrImageControls(area){
  return area.dataset.inboxId?area.querySelector('.ocr-inbox-preview'):$('#ocrImgWrap');
}
function ocrSavedImage(area,original){
  return area?ocrDraftFor(area).crop?.dataUrl||original:original;
}
function ocrShowImageChoice(area,original){
  const controls=ocrImageControls(area),cropped=!!ocrDraftFor(area).crop;
  const image=controls.querySelector('img'),dataUrl=ocrSavedImage(area,original);
  if(image.getAttribute('src')!==dataUrl) image.src=dataUrl;
  controls.querySelector('[data-ocr-restore]').hidden=!cropped;
  controls.querySelector('[data-ocr-crop-note]').hidden=!cropped;
}
function ocrChangeCrop(area,crop){
  const id=area.dataset.inboxId;
  if(id?ocrInboxBusy.has(id):ocrMountBusy) return false;
  const original=id?ocrInboxRead().find(item=>item.id===id)?.dataUrl:ocrDataUrl;
  if(!original) return false;
  const draft=ocrDraftFor(area),field=area.querySelector('[data-ocr-text]');
  const originalText=draft.crop?.originalText??field.value;
  ocrReadRuns.delete(area);
  draft.crop=crop?{...crop,originalText}:null;
  draft.lastFrame=null;
  field.closest('details').open=false;
  field.value=crop?'':originalText;
  ocrImageControls(area).querySelector('[data-ocr-frame]').textContent='框选区域';
  ocrShowImageChoice(area,original);
  ocrRenderMatchArea(area);
  if(!crop){
    const status=id?area.querySelector('[data-ocr-row-status]'):$('#ocrStatus');
    status.textContent='已恢复原图，已选表达保留。';
  }
  return true;
}
function ocrViewClamp(value,min,max){ return Math.max(min,Math.min(max,value)); }
function ocrViewportPoint(event){
  const bounds=$('#ocrImageViewport').getBoundingClientRect();
  return {x:event.clientX-bounds.left,y:event.clientY-bounds.top};
}
function ocrImagePoint(view,point){
  const image=$('#ocrViewerImage');
  return {
    x:ocrViewClamp((point.x-view.x)/(image.naturalWidth*view.scale),0,1),
    y:ocrViewClamp((point.y-view.y)/(image.naturalHeight*view.scale),0,1)
  };
}
function ocrDrawImageView(){
  const view=ocrImageView,image=$('#ocrViewerImage'),viewport=$('#ocrImageViewport');
  if(!view?.scale||!image.naturalWidth) return;
  const width=image.naturalWidth*view.scale,height=image.naturalHeight*view.scale;
  const vw=viewport.clientWidth,vh=viewport.clientHeight;
  view.x=width<=vw?(vw-width)/2:ocrViewClamp(view.x,vw-width,0);
  view.y=height<=vh?(vh-height)/2:ocrViewClamp(view.y,vh-height,0);
  Object.assign(image.style,{left:view.x+'px',top:view.y+'px',width:width+'px',height:height+'px'});
  const box=$('#ocrRegionBox'),frame=view.frame;
  box.hidden=!view.framing||!frame;
  if(frame) Object.assign(box.style,{
    left:(view.x+frame.x*width)+'px',top:(view.y+frame.y*height)+'px',
    width:(frame.width*width)+'px',height:(frame.height*height)+'px'
  });
  const unavailable=!!view.reading||!frame||frame.width*image.naturalWidth<3||frame.height*image.naturalHeight<3;
  $('#ocrRegionApply').disabled=$('#ocrRegionSave').disabled=unavailable;
}
function ocrFitImageView(){
  const view=ocrImageView,image=$('#ocrViewerImage'),viewport=$('#ocrImageViewport');
  if(!view||!image.naturalWidth) return;
  view.fit=Math.min(viewport.clientWidth/image.naturalWidth,viewport.clientHeight/image.naturalHeight);
  view.scale=view.fit;
  view.x=view.y=0;
  ocrDrawImageView();
}
function ocrZoomImageView(factor,from,to=from){
  const view=ocrImageView;
  if(!view?.scale) return;
  const scale=ocrViewClamp(view.scale*factor,view.fit,Math.max(2,view.fit*10));
  const localX=(from.x-view.x)/view.scale,localY=(from.y-view.y)/view.scale;
  view.x=to.x-localX*scale;view.y=to.y-localY*scale;view.scale=scale;
  ocrDrawImageView();
}
function ocrViewerCenter(){
  const viewport=$('#ocrImageViewport');
  return {x:viewport.clientWidth/2,y:viewport.clientHeight/2};
}
function ocrSetFrameMode(framing){
  const view=ocrImageView;
  view.framing=framing;
  $('#ocrImageViewport').classList.toggle('is-framing',framing);
  $('#ocrViewerMode').textContent=framing?'移动图片':'框选区域';
  $('#ocrRegionApply').hidden=$('#ocrRegionSave').hidden=!framing;
  $('#ocrViewerHint').textContent=framing?'拖出一个框。「裁切并识别」会用框内图片保存所选表达。':'双指放大或用＋／−，放大后拖动看细节。';
  ocrDrawImageView();
}
function ocrOpenImageView(area,framing){
  const source=ocrPreviewSource(area),dialog=$('#ocrImageViewer'),image=$('#ocrViewerImage');
  if(!source||dialog.open) return;
  const blobUrl=source instanceof Blob?URL.createObjectURL(source):null;
  ocrImageView={area,blobUrl,fit:0,scale:0,x:0,y:0,pointers:new Map(),start:null,frame:ocrDraftFor(area).lastFrame||null};
  image.onload=ocrFitImageView;
  image.onerror=()=>{ $('#ocrViewerHint').textContent='这张图片无法打开，可以返回后重新选择。'; };
  dialog.showModal();
  $('#ocrRegionApply').disabled=$('#ocrRegionSave').disabled=true;
  ocrSetFrameMode(framing);
  image.src=blobUrl||source;
}
function ocrCropPixels(image,frame){
  const x=Math.floor(frame.x*image.naturalWidth),y=Math.floor(frame.y*image.naturalHeight);
  const width=Math.min(image.naturalWidth-x,Math.ceil((frame.x+frame.width)*image.naturalWidth)-x);
  const height=Math.min(image.naturalHeight-y,Math.ceil((frame.y+frame.height)*image.naturalHeight)-y);
  const scale=Math.min(1,RECOGNIZE_MAX_EDGE/Math.max(width,height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(image,x,y,width,height,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('截图裁取失败')),'image/png'));
}
async function ocrUseImageFrame(saveCrop){
  const view=ocrImageView,dialog=$('#ocrImageViewer');
  if(!view?.frame||$('#ocrRegionApply').disabled) return;
  const frame=view.frame;
  view.reading=true;
  ocrDrawImageView();
  try{
    const blob=await ocrCropPixels($('#ocrViewerImage'),frame);
    if(ocrImageView!==view||!dialog.open) return;
    if(saveCrop){
      const dataUrl=await ocrWait(shotCompress(blob),10000,'裁后图片处理超时');
      if(ocrImageView!==view||!dialog.open||!ocrChangeCrop(view.area,{source:blob,dataUrl})) return;
    }else ocrDraftFor(view.area).lastFrame=frame;
    dialog.close();
    await ocrRecognizeMatchArea(view.area,blob,!saveCrop);
  }catch(_){
    if(ocrImageView===view){
      $('#ocrViewerHint').textContent='这次没能读取框内图像，请重新框选。';
    }
  }finally{
    if(ocrImageView===view){
      view.reading=false;
      ocrDrawImageView();
    }
  }
}

function ocrBindImageGestures(){
  const viewport=$('#ocrImageViewport');
  viewport.addEventListener('pointerdown',event=>{
    const view=ocrImageView;
    if(!view?.scale||(event.pointerType==='mouse'&&event.button!==0)) return;
    viewport.setPointerCapture(event.pointerId);
    const point=ocrViewportPoint(event);
    view.pointers.set(event.pointerId,point);
    if(view.pointers.size===1&&view.framing){
      view.previousFrame=view.frame;
      view.start=ocrImagePoint(view,point);
    }else if(view.pointers.size===2&&view.start){
      view.frame=view.previousFrame;
      view.start=null;
      ocrDrawImageView();
    }
  });
  viewport.addEventListener('pointermove',event=>{
    const view=ocrImageView;
    if(!view?.pointers.has(event.pointerId)) return;
    const old=view.pointers.get(event.pointerId),point=ocrViewportPoint(event);
    view.pointers.set(event.pointerId,point);
    if(view.pointers.size>=2){
      const other=Array.from(view.pointers).find(([id])=>id!==event.pointerId)[1];
      const distance=Math.hypot(old.x-other.x,old.y-other.y);
      if(distance>0) ocrZoomImageView(Math.hypot(point.x-other.x,point.y-other.y)/distance,
        {x:(old.x+other.x)/2,y:(old.y+other.y)/2},{x:(point.x+other.x)/2,y:(point.y+other.y)/2});
      return;
    }
    if(view.start){
      const end=ocrImagePoint(view,point);
      view.frame={x:Math.min(view.start.x,end.x),y:Math.min(view.start.y,end.y),
        width:Math.abs(view.start.x-end.x),height:Math.abs(view.start.y-end.y)};
    }else{
      view.x+=point.x-old.x;view.y+=point.y-old.y;
    }
    ocrDrawImageView();
  });
  const endGesture=event=>{
    const view=ocrImageView;
    if(!view?.pointers.delete(event.pointerId)) return;
    if(event.type==='pointercancel'&&view.start){view.frame=view.previousFrame;ocrDrawImageView();}
    view.start=null;
  };
  viewport.addEventListener('pointerup',endGesture);
  viewport.addEventListener('pointercancel',endGesture);
  viewport.addEventListener('lostpointercapture',endGesture);
  viewport.addEventListener('wheel',event=>{
    if(!ocrImageView?.scale) return;
    event.preventDefault();
    ocrZoomImageView(event.deltaY<0?1.2:1/1.2,ocrViewportPoint(event));
  },{passive:false});
}
function ocrBindSelectionUi(){
  const sheet=$('#ocrSheet'),dialog=$('#ocrImageViewer'),image=$('#ocrViewerImage');
  ocrBindImageGestures();
  window.addEventListener('resize',ocrFitImageView);
  $('#ocrViewerClose').onclick=()=>dialog.close();
  $('#ocrZoomOut').onclick=()=>ocrZoomImageView(1/1.5,ocrViewerCenter());
  $('#ocrZoomIn').onclick=()=>ocrZoomImageView(1.5,ocrViewerCenter());
  $('#ocrViewerMode').onclick=()=>ocrSetFrameMode(!ocrImageView.framing);
  $('#ocrRegionApply').onclick=()=>ocrUseImageFrame(false);
  $('#ocrRegionSave').onclick=()=>ocrUseImageFrame(true);
  dialog.addEventListener('close',()=>{
    if(dialog.open) return;
    if(ocrImageView?.blobUrl) URL.revokeObjectURL(ocrImageView.blobUrl);
    ocrImageView=null;
    image.removeAttribute('src');
  });
  sheet.addEventListener('click',event=>{
    const button=event.target.closest('[data-ocr-preview],[data-ocr-frame],[data-ocr-whole],[data-ocr-restore],[data-ocr-token],[data-ocr-add-selected],[data-ocr-unpick]');
    if(!button) return;
    const area=button.closest('[data-ocr-area]')||$('#ocrSelected');
    if(button.matches('[data-ocr-preview],[data-ocr-frame]')) ocrOpenImageView(area,button.hasAttribute('data-ocr-frame'));
    if(button.hasAttribute('data-ocr-whole')) ocrRecognizeMatchArea(area,ocrPreviewSource(area),false);
    if(button.hasAttribute('data-ocr-restore')) ocrChangeCrop(area,null);
    if(button.hasAttribute('data-ocr-token')) ocrPickToken(area,button);
    if(button.hasAttribute('data-ocr-add-selected')) ocrAddSelectedTerm(area);
    if(button.hasAttribute('data-ocr-unpick')){
      ocrDraftFor(area).picks.delete(button.dataset.ocrUnpick);
      ocrRefreshTermPicker(area);
    }
  });
  const syncTextSelection=field=>{
    if(!field?.matches('#ocrSheet [data-ocr-text]')) return;
    const area=field.closest('[data-ocr-area]'),draft=ocrDraftFor(area);
    if(field.selectionEnd>field.selectionStart){
      draft.inputSpan=[field.selectionStart,field.selectionEnd];
      draft.anchor=draft.end=null;
    }else draft.inputSpan=null;
    ocrRefreshTermPicker(area);
  };
  sheet.addEventListener('select',event=>syncTextSelection(event.target));
  document.addEventListener('selectionchange',()=>syncTextSelection(document.activeElement));
}
ocrBindSelectionUi();
