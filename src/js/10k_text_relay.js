/* ============ 文本 relay 前端（独立 key，不碰主数据，与自带 Key 并存可回滚） ============ */
const TEXT_DEVICE_KEY='english-notes-device-v1';
const TEXT_RELAY_KEY='english-notes-text-relay-v1';
/* 部署后零配置的默认地址；未部署时没 Key 的请求会得到清晰的网络错误 */
const LEGACY_TEXT_RELAY_DEFAULT='https://english-notes-relay.3374055718-de9.workers.dev';
const USE_COMMERCIAL_TEXT_RELAY=globalThis.APP_CONFIG?.product==='commercial';
const TEXT_RELAY_DEFAULT=USE_COMMERCIAL_TEXT_RELAY?'https://api.simonnotes.xyz':LEGACY_TEXT_RELAY_DEFAULT;

/* 设备 id：独立 key 持久化，用于 Worker 限流与计量 */
function deviceIdGet(){
  try{
    let v=localStorage.getItem(TEXT_DEVICE_KEY);
    if(!v||!/^[A-Za-z0-9_-]{8,64}$/.test(v)){
      v='d'+uid();
      localStorage.setItem(TEXT_DEVICE_KEY,v);
    }
    return v;
  }catch(_){ return 'd'+uid(); }
}
function textRelayConfig(){
  const saved=aRead(TEXT_RELAY_KEY,{});
  const relayUrl=String(saved?.relayUrl||TEXT_RELAY_DEFAULT).trim();
  if(USE_COMMERCIAL_TEXT_RELAY&&(!relayUrl||relayUrl.replace(/\/+$/,'')===LEGACY_TEXT_RELAY_DEFAULT)){
    return {relayUrl:TEXT_RELAY_DEFAULT};
  }
  return {relayUrl};
}
function textRelaySave(patch){
  const next=Object.assign({},textRelayConfig(),patch);
  aStore(TEXT_RELAY_KEY,JSON.stringify(next));
  return next;
}
/* 走免 Key 中转。返回上游 message 的 content 字符串；429/错误抛出带 status 的 Error。 */
async function textRelayFetch(messages,opts){
  const relay=textRelayConfig().relayUrl.replace(/\/+$/,'');
  if(!relay) throw new Error('没有可用的免 Key 中转地址');
  const once=async(useJson)=>{
    const ctrl=new AbortController();
    const to=opts&&opts.timeout||30000;
    const timer=setTimeout(()=>ctrl.abort(),to);
    try{
      const body={model:'deepseek-flash',temperature:0.85,messages};
      if(opts&&opts.maxTokens)body.max_tokens=opts.maxTokens;
      if(useJson)body.response_format={type:'json_object'};
      const res=await fetch(relay+'/v1/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','X-Device-Id':deviceIdGet(),...accountAuthHeader()},
        body:JSON.stringify(body),
        signal:ctrl.signal
      });
      if(!res.ok){
        throw await textRelayError(res);
      }
      const data=await res.json();
      const message=data&&data.choices&&data.choices[0]&&data.choices[0].message||{};
      return message.content||message.reasoning_content||'';
    }finally{ clearTimeout(timer); }
  };
  try{
    return await once(true);   /* 中转默认 DeepSeek，支持 json mode */
  }catch(err){
    if(err&&err.status===400)return await once(false);
    throw err;
  }
}
async function textRelayError(res){
  const data=await res.json().catch(()=>null);
  const message=typeof data?.message==='string'?data.message.trim():'';
  const err=new Error(message||('HTTP '+res.status));
  err.status=res.status;
  return err;
}
async function dialogueReviewFetch(answers,requestId,tone){
  const relay=textRelayConfig().relayUrl.replace(/\/+$/,'');
  if(!relay)throw new Error('没有可用的免 Key 中转地址');
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),35000);
  const token=accountToken();
  try{
    const res=await fetch(relay+'/v1/dialogue/review',{
      method:'POST',
      headers:{'Content-Type':'application/json',...accountAuthHeader()},
      body:JSON.stringify({requestId,tone,answers}),
      signal:ctrl.signal
    });
    if(!res.ok)throw await textRelayError(res);
    const data=await res.json();
    if(!Array.isArray(data?.reviews)||data.reviews.length!==answers.length||
      data.reviews.some(review=>typeof review?.standard!=='string'||!review.standard.trim())){
      throw new Error('未收到完整批改，请原样重试');
    }
    return data.reviews;
  }finally{
    clearTimeout(timer);
    if(token&&token===accountToken())accountRefresh();
  }
}
/* 图片中转：本地先判抽象，Worker 内抽象词 LLM 改写后走 Openverse(认证)→Pixabay。返回 {source,candidates,usage}。 */
async function imgRelayFetch(term,context){
  const relay=textRelayConfig().relayUrl.replace(/\/+$/,'');
  if(!relay)throw new Error('没有可用的中转地址');
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),30000);   /* 多源接力，给足时间 */
  try{
    const res=await fetch(relay+'/v1/images/generations',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Device-Id':deviceIdGet(),...accountAuthHeader()},
      body:JSON.stringify({term:String(term||''),context:String(context||''),abstract:isAbstractTerm(term)}),
      signal:ctrl.signal
    });
    if(!res.ok){
      const err=new Error(res.status===429?'用的人太多，稍后再试':('图片中转 HTTP '+res.status));
      err.status=res.status;
      throw err;
    }
    return await res.json();
  }finally{ clearTimeout(timer); }
}
