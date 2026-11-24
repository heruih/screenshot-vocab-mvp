/* v2: private cloud snapshot, optimistic concurrency and three-way merging. */
const B_BASE='english-notes-cloud-base-v2';
let bApplying=false,bTimer=0,bRunning=false,bQueued=false,bStatus='正在连接云端…',bBase={};
const bSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function bMerge(base,local,remote){
  if(bSame(local,base))return remote;if(bSame(remote,base)||bSame(local,remote))return local;
  if(Array.isArray(local)&&Array.isArray(remote)){
    if([...local,...remote].every(x=>x&&typeof x==='object'&&typeof x.id==='string')){
      const bm=new Map((Array.isArray(base)?base:[]).map(x=>[x.id,x])),lm=new Map(local.map(x=>[x.id,x])),rm=new Map(remote.map(x=>[x.id,x]));
      return [...new Set([...lm.keys(),...rm.keys()])].map(id=>bMerge(bm.get(id),lm.get(id),rm.get(id))).filter(x=>x!==undefined);
    }
    return [...new Set([...remote,...local])];
  }
  if(local&&remote&&typeof local==='object'&&typeof remote==='object'&&!Array.isArray(local)&&!Array.isArray(remote)){
    if(local.id&&remote.id&&(local.updatedAt||remote.updatedAt))return (local.updatedAt||0)>=(remote.updatedAt||0)?local:remote;
    const out={};for(const k of new Set([...Object.keys(local),...Object.keys(remote)])){const v=bMerge(base&&base[k],local[k],remote[k]);if(v!==undefined)out[k]=v;}return out;
  }
  return local===undefined?remote:local;
}
function bSnapshot(){
  const all=aBackupKeys(),out={};
  for(const [k,v]of Object.entries(all)){
    if([B_BASE,A_PREF_KEY,'english-notes-hint-v1'].includes(k)||k.includes('qdict')||k.includes('wmimg')||k.includes('cloud-'))continue;
    try{out[k]=JSON.parse(v);}catch(_){}
  }
  out[LS_KEY]={words:state.words,notes:state.notes,folders:state.folders,aiLog:state.aiLog,grave:state.grave||[],tagList:state.tagList||[]};
  return JSON.parse(JSON.stringify(out));
}
let bStatusTimer=0,bOkQuietUntil=0,bHasPendingSave=false;
function bSetStatus(text,force){
  bStatus=text;
  const s=$('#bCloudStatus');
  if(!s)return;
  const isErr=/未完成|失败|离线|错误|不可用|重试|请用/.test(text);
  clearTimeout(bStatusTimer);
  if(!isErr){
    // 成功态节流：连续编辑反复保存时不重复弹，force（退出/切换）时强制显示一次
    const now=Date.now();
    if(!force&&now<bOkQuietUntil)return;
    bOkQuietUntil=now+4000;
    s.textContent=text;
    s.classList.add('show');
    bStatusTimer=setTimeout(()=>s.classList.remove('show'),1500);
  }else{
    s.textContent=text;
    s.classList.add('show');
  }
}
function bQueue(){if(bApplying)return;bHasPendingSave=true;clearTimeout(bTimer);bTimer=setTimeout(()=>bSync(),1600);}
// 退出笔记/切换页面时，若有尚未确认的保存，强制提示一次
function bFlushSaveHint(){
  if(!bHasPendingSave)return;
  clearTimeout(bTimer);
  bHasPendingSave=false;
  /* 成功保存静默，不再弹「本机已保存」；同步失败/离线等错误态仍由 bSync 的 catch 分支提示 */
}
const bStore=aStore;
aStore=function(k,v){const ok=bStore(k,v);if(ok&&!bApplying&&k!==B_BASE)bQueue();return ok;};
function bApply(doc){
  bApplying=true;
  try{
    const currentSettings=state.settings,currentMeta=state.meta;
    for(const [key,value]of Object.entries(doc)){if(!key.startsWith('english-notes-')||key===B_BASE)continue;if(key===LS_KEY){state=migrate(Object.assign({},value,{settings:currentSettings,meta:currentMeta}));if(!bStore(key,JSON.stringify(state)))throw Error('本机存储不足');}else if(!bStore(key,JSON.stringify(value)))throw Error('本机存储不足');}
    aData=aRead(A_KEY,{words:{},attempts:[]});
  }finally{bApplying=false;}
}
async function bFetch(url,options={}){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);try{const response=await fetch(url,{...options,headers:{'X-Notes-Client':'v2',...(options.headers||{})},signal:ctrl.signal});if(response.status===401||response.status===403||response.redirected||(response.headers.get('Content-Type')||'').includes('text/html'))throw Error('请用同一 ChatGPT 账号重新登录');return response;}finally{clearTimeout(timer);}}
async function bSync(){
  if(bRunning){bQueued=true;return;}bRunning=true;clearTimeout(bTimer);bSetStatus('正在同步…');
  try{
    for(let attempt=0;attempt<3;attempt++){
      const r=await bFetch('/api/library');if(!r.ok)throw Error('云端暂不可用');const remote=await r.json();
      const local=bSnapshot(),merged=bMerge(bBase,local,remote.storage||{});
      if(bSame(merged,remote.storage||{})){
        bApply(merged);bBase=merged;bStore(B_BASE,JSON.stringify(bBase));bSetStatus('已同步 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));
        if(!$('#wordModal').classList.contains('show')&&!$('#writeModal').classList.contains('show')&&!$('#aiModal').classList.contains('show')&&ui.mode!=='edit')render();return;
      }
      const p=await bFetch('/api/library',{method:'PUT',headers:{'Content-Type':'application/json','X-Notes-Revision':remote.revision||'none'},body:JSON.stringify({storage:merged,revision:remote.revision||'none'})});
      if(p.status===409)continue;if(!p.ok)throw Error('云保存失败');
      // Keep edits made while the request was in flight, and send them next.
      const now=bSnapshot(),finalDoc=bMerge(local,now,merged);bApply(finalDoc);bBase=merged;bStore(B_BASE,JSON.stringify(bBase));
      if(!bSame(finalDoc,merged))bQueued=true;
      bSetStatus('已同步 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));
      if(!$('#wordModal').classList.contains('show')&&!$('#writeModal').classList.contains('show')&&!$('#aiModal').classList.contains('show')&&ui.mode!=='edit')render();
      return;
    }
    throw Error('另一台设备正在保存，稍后重试');
  }catch(e){bSetStatus((navigator.onLine===false?'离线：已存本机':'同步未完成：'+e.message)+' · 点此重试');}
  finally{bRunning=false;if(bQueued){bQueued=false;bQueue();}}
}
const bToday=renderToday;
renderToday=function(){bToday();const panel=document.createElement('div');panel.className='a-callout';panel.innerHTML='<b>每天一小轮</b><p>看视频 → 收集 3—5 个表达 → 自己整理 → 回想 → 情景输出。</p><div class="a-actions"><button class="btn" id="bAudioOpen">原音与跟读</button><button class="btn" id="bCopyLink">复制本应用链接</button><button class="btn" id="bWeekly">本周进度</button></div><p class="a-note">同一账号跨设备自动同步；接口密钥仅保存在各自设备。</p>';$('#noteList').append(panel);$$('#noteList .a-note').forEach(el=>{if(el.textContent.includes('新地址不会自动读取'))el.textContent='ChatGPT 练习沿用你账号中的可用模型；学习内容已接入本应用的私有云保存。';});$('#bAudioOpen').onclick=()=>bOpenAudio();$('#bCopyLink').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin);toast('应用链接已复制，其他设备用同一账号打开即可');}catch(_){toast(location.origin);}};$('#bWeekly').onclick=bShowWeekly;pfWrap();};
function bShowWeekly(){const start=Date.now()-7*DAY,logs=aData.attempts.filter(x=>x.createdAt>=start);showConfirm({title:'最近 7 天',msg:'新增 '+state.words.filter(w=>w.createdAt>=start).length+' 个表达；实际练习 '+logs.length+' 次；独立用出 '+new Set(logs.filter(x=>x.result==='independent').map(x=>x.wordId)).size+' 个表达。记录代表练习经历，仍需换场景验证。',okText:'继续学习'});}
function bOpenAudio(word){
  $('#bAudio').classList.add('show');const select=$('#bAudioWord');select.innerHTML=state.words.map(w=>'<option value="'+esc(w.id)+'">'+esc(w.term)+'</option>').join('');if(word)select.value=word.id;bLoadAudio();
}
function bLoadAudio(){const id=$('#bAudioWord').value,m=(aRead('english-notes-audio-v2',{})||{})[id]||{};$('#bOriginalAudio').src=m.original||'';$('#bOwnAudio').src=m.own||'';$('#bOriginalAudio').loop=true;$('#bAudioHint').textContent=m.original?'原音已保存，可跨设备播放。':'上传你保存的短音频／视频片段（每段最多 12 MB），或先用原有系统朗读跟读。';$('#bStart').value=m.start||0;$('#bEnd').value=m.end||'';}
async function bUploadAudio(file,kind){
  if(!file)return;if(file.size>12*1024*1024){toast('请先截成 12 MB 以内的短片段','warn');return;}
  if(!/^(audio|video)\//.test(file.type)){toast('请选择音频或视频文件','warn');return;}
  const wordId=$('#bAudioWord').value;if(!wordId){toast('先选择一个表达');return;}
  $('#bAudioHint').textContent='正在保存片段…';
  try{const r=await bFetch('/api/media',{method:'POST',headers:{'Content-Type':file.type},body:file});if(!r.ok)throw Error('上传失败');const v=await r.json(),all=aRead('english-notes-audio-v2',{});all[wordId]={...(all[wordId]||{}),[kind]:v.url,updatedAt:Date.now()};aStore('english-notes-audio-v2',JSON.stringify(all));if($('#bAudioWord').value===wordId)bLoadAudio();await bSync();}catch(e){$('#bAudioHint').textContent=e.message+'。本次片段尚未保存，请重试。';}
}
let bRecorder=null,bRecordingRequest=null;
async function bToggleRecord(){
  if(bRecorder?.state==='recording'){bRecorder.stop();return;}
  if(bRecorder||bRecordingRequest)return;
  const word=$('#bAudioWord'),button=$('#bRecord');
  if(!word.value){toast('先添加或选择一个表达');return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('这个浏览器不支持录音，可以上传录音文件');return;}
  const request={};
  bRecordingRequest=request;
  word.disabled=true;
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(bRecordingRequest!==request){stream.getTracks().forEach(track=>track.stop());return;}
    const recorder=new MediaRecorder(stream),chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{
      stream.getTracks().forEach(track=>track.stop());
      bRecorder=null;
      button.textContent='录下我的声音';
      word.disabled=false;
      if(chunks.length)bUploadAudio(new Blob(chunks,{type:recorder.mimeType||chunks[0].type}),'own');
    };
    recorder.start();
    bRecorder=recorder;
    button.textContent='停止并保存录音';
  }catch(_){
    stream?.getTracks().forEach(track=>track.stop());
    if(bRecordingRequest===request)toast('录音未开启，可检查 Sitecase 的麦克风权限或上传录音文件','warn');
  }finally{
    if(bRecordingRequest===request){
      bRecordingRequest=null;
      if(!bRecorder)word.disabled=false;
    }
  }
}
const bCommitImport=aCommitImport;
aCommitImport=function(prepared){bCommitImport(prepared);bQueue();};
function bInit(){
  bBase=aRead(B_BASE,{});
  /* 帮助文字以 index.html 静态 .st-help 为准（商业化新口径），不再用云同步旧文案覆盖 */
  const status=document.createElement('button');status.id='bCloudStatus';status.className='btn cloud-status';status.textContent=bStatus;status.onclick=()=>bSync();document.body.append(status);
  $('#bAudioClose').onclick=()=>{if(bRecorder){toast('请先停止并保存录音');return;}bRecordingRequest=null;$('#bAudioWord').disabled=false;$('#bOriginalAudio').pause();$('#bOwnAudio').pause();$('#bAudio').classList.remove('show');};$('#bAudioWord').onchange=bLoadAudio;$('#bAudioUpload').onchange=e=>{bUploadAudio(e.target.files[0],'original');e.target.value='';};$('#bOwnUpload').onchange=e=>{bUploadAudio(e.target.files[0],'own');e.target.value='';};$('#bRecord').onclick=bToggleRecord;
  $('#bSpeed').onchange=e=>$('#bOriginalAudio').playbackRate=Number(e.target.value);
  $('#bOriginalAudio').ontimeupdate=()=>{const a=$('#bOriginalAudio'),start=Number($('#bStart').value)||0,end=Number($('#bEnd').value);if(end>start&&a.currentTime>=end)a.currentTime=start;};
  $('#bSaveRange').onclick=()=>{const id=$('#bAudioWord').value,start=Number($('#bStart').value)||0,end=Number($('#bEnd').value)||0;if(!id||start<0||(end&&end<=start)){toast('结束时间需要大于开始时间');return;}const all=aRead('english-notes-audio-v2',{});all[id]={...(all[id]||{}),start,end,updatedAt:Date.now()};aStore('english-notes-audio-v2',JSON.stringify(all));toast('循环范围已保存');};
  $('#bSystemFollow').onclick=()=>{if(bRecorder){toast('请先停止录音');return;}bRecordingRequest=null;$('#bAudioWord').disabled=false;const w=state.words.find(w=>w.id===$('#bAudioWord').value);if(w){$('#bOriginalAudio').pause();$('#bAudio').classList.remove('show');openFollow(aMeta(w).original||w.examples?.[0]?.en||w.term,w.term,'');}};
  window.addEventListener('online',()=>bSync());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')bSync();});
  setInterval(()=>{if(document.visibilityState==='visible')bSync();},60000);
  bSync();
}

