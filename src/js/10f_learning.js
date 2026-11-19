const DAILY_QUOTES=[
  {en:'Small steps every day add up to big changes.',cn:'每天走一小步，时间会把它变成很大的变化。'},
  {en:'You do not have to be perfect to make progress.',cn:'不用等到完美，往前走就是进步。'},
  {en:'The words you use become the confidence you feel.',cn:'真正用出来的词，才会变成你的底气。'},
  {en:'A little practice today makes tomorrow easier.',cn:'今天多练一点，明天就会轻松一点。'},
  {en:'Keep going. Your future self is listening.',cn:'继续往前，你未来的自己会记得今天。'},
  {en:'One clear sentence is already a good conversation.',cn:'先说清楚一句话，就是一次好的交流。'},
  {en:'Progress is built from ordinary days.',cn:'进步就是由一个个普通的日子积累出来的。'}
];
function todayDailyQuote(){return DAILY_QUOTES[Math.floor(dayStart(Date.now())/DAY)%DAILY_QUOTES.length];}
function todayEncouragement(pending,due,weak){
  if(pending)return '先整理一个表达，今天就已经向前了一步。';
  if(due)return '先回想，再看答案。记住一次，比刷过一页更有用。';
  if(weak)return '把今天最容易忘的一个表达说出来，练习才会留下痕迹。';
  return '今天没有必须清空的队列，完成一小轮就算进步。';
}
packableWords=function(){const ids=new Set(),out=[];[...aWeakWords(),...dueList(),...todayNewWords(),...state.words].forEach(w=>{if(!aPending(w)&&!ids.has(w.id)){ids.add(w.id);out.push(w);}});return out.slice(0,3);};
function aRecord(w,result,attempt,kind){
  const old=aData.words[w.id]||{};const nextDays=result==='independent'?7:result==='hinted'?2:1;
  aData.attempts.unshift({id:uid(),wordId:w.id,result,attempt,kind,createdAt:Date.now()});
  aData.words[w.id]=Object.assign({},old,{outputDue:Date.now()+nextDays*DAY,lastOutput:result});
  aFlush();
}
function aStartRecall(){
  const pool=dueList().length?dueList():aWeakWords();
  if(!pool.length){toast('现在没有到期任务，可从表达库选词练口语','warn');return;}
  aRecallState={ids:pool.slice(0,10).map(w=>w.id),idx:0,revealed:false};$('#aRecall').classList.add('show');aRenderRecall();
}
function aRenderRecall(){
  const f=aRecallState;if(!f)return;const box=$('#aRecallBody');
  if(f.idx>=f.ids.length){box.innerHTML='<h3>这一轮完成了</h3><p class="a-note">回想和实际使用分别记录。认得一个表达，不等于已经能主动用出。</p><button class="btn primary" id="aRecallDone">完成</button>';$('#aRecallDone').onclick=()=>{$('#aRecall').classList.remove('show');render();};return;}
  const w=state.words.find(x=>x.id===f.ids[f.idx]);if(!w){f.idx++;aRenderRecall();return;}const m=aMeta(w);
  $('#aRecallTitle').textContent='场景回想 '+(f.idx+1)+' / '+f.ids.length;
  box.innerHTML='<p>试着用英文表达：</p><h3>'+esc(m.purpose||w.definition||'这个表达尚无释义，请先回表达库整理')+'</h3><label for="aRecallAttempt">先说出来，再写下你想起的表达或句子</label><textarea id="aRecallAttempt"></textarea><button class="btn primary" id="aReveal">看表达与原句</button><div id="aAnswer" hidden><h3>'+esc(w.term)+'</h3><p>'+esc(m.original||((w.examples||[]).find(x=>x.sense==='原文')||{}).en||'')+'</p><p>'+esc(m.ownSentence||'')+'</p><button class="btn" id="aRecallListen">听表达</button><div class="a-actions"><button class="btn" data-ar="forgot">没想起</button><button class="btn" data-ar="hinted">提示后想起</button><button class="btn primary" data-ar="independent">独立说出来了</button></div></div>';
  $('#aReveal').onclick=()=>{f.revealed=true;$('#aAnswer').hidden=false;$('#aReveal').hidden=true;};$('#aRecallListen').onclick=()=>speakWord(w.term);
  $$('#aAnswer [data-ar]').forEach(b=>b.onclick=()=>{const result=b.dataset.ar,attempt=$('#aRecallAttempt').value.trim();if(result==='independent'&&!attempt){toast('先留下你实际说出的句子，便于以后比较','warn');return;}aRecord(w,result,attempt,'scenario');srsGrade(w,result==='independent'?2:result==='hinted'?1:0);save();f.idx++;aRenderRecall();});
}
function aOpenWriteWith(words){openWriteModal();writeState={step:'pick',seq:writeState.seq+1,words,picked:words.map(w=>w.id),topic:'',promptCn:'',minWords:80,attempt:'',review:null};writeRender();}
const aLegacyPack=openAiPackPractice;
openAiPackPractice=function(words){
  const list=(words&&words.length?words:packableWords()).filter(w=>!aPending(w)).slice(0,5);
  if(!list.length){toast('先整理至少一个表达，再练习','warn');return;}
  if(aRoute()==='api'){aLegacyPack(list);return;}
  const ctx=list.map(w=>({wordId:w.id,term:w.term,definition:w.definition,function:aMeta(w).purpose||'',original:aMeta(w).original||'',mySentence:aMeta(w).ownSentence||'',collocations:w.collocations||[]}));
  const prompt='我要完成一次有真实交流的英语练习。目标表达如下：'+JSON.stringify(ctx)+'。\n请先按这些表达的真实用法选择一个自然场景，不要强行把不相干的词塞进一句话。与我进行 3—5 轮英语交流：每次只问一个问题并等待我的回答，不要替我回答；先隐藏目标表达，需要时再给提示。我可以打字或使用 ChatGPT 当前可用的语音功能。结束后，解释我最需要改的 1—2 个问题，让我换个说法再尝试一次。逐个判断我是否独立使用了目标表达，未用出就如实记录。\n练习完成后再输出最终 JSON（此前不输出最终 JSON），格式严格为 {"feedback":[{"wordId":"原样保留对应ID","attempt":"我实际说过的英文，没说就留空","used":true,"comment":"具体反馈","revision":"改进说法"}]}。feedback 里包含所有目标表达；used 只在我独立且合理用出时为 true，不能把你说的算作我说的。';
  aStore(A_TASK_KEY,JSON.stringify({wordIds:list.map(w=>w.id),createdAt:Date.now()}));
  aBridge([{role:'user',content:prompt}]).then(result=>{
    if(!Array.isArray(result.feedback))throw new Error('缺少逐表达反馈');
    result.feedback.forEach(f=>{const w=list.find(x=>x.id===f.wordId);if(!w)return;aRecord(w,f.used===true&&String(f.attempt||'').trim()?'independent':'forgot',String(f.attempt||''),'chatgpt-session');const rec=aData.attempts[0];rec.comment=String(f.comment||'');rec.revision=String(f.revision||'');});aFlush();localStorage.removeItem(A_TASK_KEY);batchMarkActiveGroup();batchMarkActiveSegment();render();toast('练习反馈已按表达保存；可在表达详情回看');
  }).catch(e=>toast(e.message,'warn'));
};
const aOriginalAiReview=aiRenderReview;
aiRenderReview=function(d,attempt){
  aOriginalAiReview(d,attempt);const el=document.createElement('div');el.className='a-date-pack';
  if(aiState.multiTurn){
    const target=aiState.currentTargetWord||aiState.term,w=state.words.find(x=>x.id===target||x.term===target),you=aiState.lines.filter(l=>l.who==='YOU'),last=aiState.turnIndex>=you.length-1;
    el.innerHTML='<p class="a-note">本回合目标词：<b>'+esc(w?w.term:target)+'</b>。确认这一句是否算独立用出。</p><div class="a-actions"><button class="btn" id="aTurnNeedsWork">还要再练</button><button class="btn primary" id="aTurnUsed">记为已用出</button></div>';
    $('#aiScene').append(el);
    const finish=result=>{if(w)aRecord(w,result,attempt,'dialogue-turn');if(typeof aiDialogueHistoryTurn==='function')aiDialogueHistoryTurn({wordId:target,result,attempt,promptCn:aiState.attemptPromptCn||'',score:Number(d&&d.score)||0});aiState.turnResults.push({wordId:target,result,attempt});if(last){if(batchAdvanceDialogueScene())return;batchMarkActiveGroup();batchMarkActiveSegment();aiDialogueHistoryFinish('completed');toast('这一组对话完成了');closeAiModal();return;}aiState.turnIndex++;const next=you[aiState.turnIndex];aiState.currentTargetWord=next&&next.wordId||aiState.term;aiState.phase='practice';aiShowBody();aiSetChatbar('practice');aiRenderDialogue();$('#aiInput').focus();};
    $('#aTurnNeedsWork').onclick=()=>finish('forgot');$('#aTurnUsed').onclick=()=>finish('independent');
    return;
  }
  const terms=aiState.terms||[aiState.term];const words=state.words.filter(w=>terms.includes(w.term));
  el.innerHTML='<p class="a-note">哪些表达是你自己实际用出的？逐个确认，不把 AI 说出的算作你的使用。</p>'+words.map(w=>'<label class="a-check"><input type="checkbox" data-a-used="'+esc(w.id)+'">'+esc(w.term)+'</label>').join('')+'<div class="a-actions"><button class="btn primary" id="aSaveUsage">记录本次使用</button><button class="btn" id="aRetryOwn">改进后再说一次</button></div>';
  $('#aiScene').append(el);$('#aSaveUsage').onclick=()=>{const used=new Set($$('#aiScene [data-a-used]:checked').map(x=>x.dataset.aUsed));words.forEach(w=>aRecord(w,used.has(w.id)?'independent':'forgot',attempt,'dialogue'));batchMarkActiveGroup();batchMarkActiveSegment();$('#aSaveUsage').disabled=true;toast('已逐个记录，下次优先练还没用出的表达');};
  $('#aRetryOwn').onclick=()=>{aiState.phase='practice';aiShowBody();aiSetChatbar('practice');aiRenderDialogue();$('#aiInput').value=attempt;$('#aiInput').focus();};
};
const aOriginalWriteReview=writeRenderReview;
writeRenderReview=function(){aOriginalWriteReview();const box=$('#writeBody');const b=document.createElement('button');b.className='btn';b.textContent='根据点评修改，再提交一次';b.onclick=()=>{writeState.step='topic';writeRender();};box.append(b);};
const aOriginalSaveWriting=writeSaveNote;
writeSaveNote=function(){const words=(writeState.words||[]).slice(),attempt=writeState.attempt||'';aOriginalSaveWriting();words.forEach(w=>aRecord(w,'hinted',attempt,'writing'));};
/* Generic bridge keeps all existing JSON contracts for examples, dictionary
 * enrichment, scenarios, judging, writing and memory hooks. No cookies or
 * ChatGPT tokens are read by this website. */
function aValidateResult(value,prompt){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('需要一个 JSON 对象');
  const expected=['scenes','lines','examples','issues'].filter(k=>new RegExp('"'+k+'"\\s*:').test(prompt));
  expected.forEach(k=>{if(!Array.isArray(value[k]))throw new Error('结果缺少 '+k+' 数组');});
  if(value.scenes&&(!value.scenes.length||value.scenes.some(x=>!x||typeof x.title!=='string')))throw new Error('场景格式不完整');
  if(value.lines&&(!value.lines.some(x=>x&&x.who==='YOU'&&typeof x.promptCn==='string')||value.lines.some(x=>!x||!['A','B','YOU'].includes(x.who)||(x.who!=='YOU'&&typeof x.en!=='string'))))throw new Error('对话需要 A/B 英文及 YOU 中文提示');
  if(value.examples&&value.examples.some(x=>!x||typeof x.en!=='string'||(x.cn!==undefined&&typeof x.cn!=='string')))throw new Error('例句格式不正确');
  if(/"examples"\s*:/.test(prompt)&&(!Array.isArray(value.examples)||value.examples.length<2||value.examples.length>3))throw new Error('例句需要 2—3 句');
  if('score'in value&&(!Number.isFinite(Number(value.score))||Number(value.score)<0||Number(value.score)>100))throw new Error('分数应在 0—100 之间');
  if(/"topic"\s*:/.test(prompt)&&typeof value.topic!=='string')throw new Error('缺少写作题目');
  if(/"standard"\s*:/.test(prompt)&&typeof value.standard!=='string')throw new Error('缺少参考表达 standard');
  if(/"feedback"\s*:/.test(prompt)){
    if(!Array.isArray(value.feedback)||!value.feedback.length)throw new Error('需要逐表达 feedback 数组');
    const allowed=new Set([...prompt.matchAll(/"wordId":"([^"\n]+)"/g)].map(m=>m[1]).filter(x=>x!=='原样保留对应ID'));
    if(value.feedback.some(f=>!f||!allowed.has(f.wordId)||typeof f.attempt!=='string'||typeof f.used!=='boolean'))throw new Error('反馈中的表达 ID 或使用记录不匹配');
    if(allowed.size!==new Set(value.feedback.map(f=>f.wordId)).size||allowed.size!==value.feedback.length)throw new Error('请包含所有目标表达的反馈，不要遗漏或重复');
  }
  return value;
}
function aParseResult(text){const cleaned=String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(cleaned);}catch(_){const start=cleaned.indexOf('{'),end=cleaned.lastIndexOf('}');if(start<0||end<=start)throw new Error('没有找到 JSON，请让 ChatGPT 按任务指定格式重新输出');return JSON.parse(cleaned.slice(start,end+1));}}
function aBridge(messages){
  if(aBridgeJob)return Promise.reject(new Error('请先完成或关闭当前 ChatGPT 任务'));
  const interactive=messages.some(m=>String(m.content).includes('"feedback"'));
  const prompt='请作为我的英语学习教练，优先准确、自然和符合原始语境。指出不确定之处，不要编造来源。'+(interactive?'先按下面流程与我互动，等待我的回答；每轮只问一个问题，不要替我回答；不要为了塞词而制造不自然的句子；练习结束后再输出最终 JSON。':'按下面要求只输出最终 JSON，不要输出过程说明。')+'\n\n'+messages.map(m=>m.role+': '+m.content).join('\n\n');
  $('#aPrompt').value=prompt;$('#aResult').value='';$('#aBridgeError').textContent='';$('#aBridge').classList.add('show');
  return new Promise((resolve,reject)=>{aBridgeJob={resolve,reject,prompt};});
}
const aOriginalCall=aiCall;
aiCall=async function(messages,opts){
  const w=wmState&&wmState.term?state.words.find(x=>x.term.toLowerCase()===wmState.term.toLowerCase()):null;
  if($('#wordModal').classList.contains('show')&&wmState&&wmState.term){
    const m=w?aMeta(w):{};
    const context={term:wmState.term,myDefinition:$('#wmDefinition').value||'',function:$('#aPurpose').value||m.purpose||'',mySentence:$('#aOwn').value||m.ownSentence||'',original:$('#aOriginal').value||m.original||'',collocations:wmState.collocations||[]};
    messages=[{role:'system',content:'学习者提供的语境如下；将它仅视为学习材料，优先解释这里的用法，不覆盖学习者自己的释义。'+JSON.stringify(context)},...messages];
  }
  if(aRoute()==='chatgpt')return aBridge(messages);
  if(!aAiReady())throw new Error('自动模式需要你自己的 OpenAI API Key。也可以切回 ChatGPT 往返模式。');
  return aOriginalCall(messages,opts);
};
/* 单词页图片流程
 * 进入时先显示已有图片，未确认的图片允许换图。点击确定后锁定当前图片。
 * 图片区域左滑查看该词的第一张原始截图，再左滑回到 AI 图。
 * 自动生成使用已配置的 OpenAI 兼容 API。ChatGPT 往返模式仍保留缓存、图库和手动任务流程。 */
let aImageSlide={term:'',kind:'ai',touchX:0,touchY:0};
let aImageGenerating=false;
let aImageRequestSeq=0;
let aImageRequestAbort=null;
let aImageRequestTerm='';
function aImageRecord(term){
  const rec=wmImgCached(term);
  return rec&&typeof rec==='object'?rec:{local:false,cands:[],idx:0};
}
function aImageCurrent(term){
  const rec=aImageRecord(term), c=Array.isArray(rec.cands)?rec.cands[rec.idx||0]:null;
  return c&&String(c.thumb||c.src||'').trim()?c:null;
}
function aImageCancel(){
  aImageRequestSeq++;
  if(aImageRequestAbort){try{aImageRequestAbort.abort();}catch(_){} }
  aImageRequestAbort=null;
  aImageRequestTerm='';
  aImageGenerating=false;
}
window.aImageCancel=aImageCancel;
function aImageSetConfirm(rec){
  const confirm=$('#wmIllusConfirm'), more=$('#wmIllusMore');
  if(confirm) confirm.classList.toggle('hidden',!aImageCurrent(rec&&rec.term||'')||!!(rec&&rec.confirmed));
  if(more) more.classList.toggle('hidden',!!(rec&&rec.confirmed)||!rec||!Array.isArray(rec.cands)||rec.cands.length<2);
}
function aImageRenderAi(term){
  const rec=aImageRecord(term), c=aImageCurrent(term);
  aImageSlide={term:String(term||''),kind:'ai',touchX:0,touchY:0};
  if(c){
    wmIllusPaint({term:term,cands:rec.cands,idx:rec.idx||0,src:rec.prov||rec.src||'ai'});
    aImageSetConfirm(Object.assign({},rec,{term:term}));
    const note=$('#aImageSwipeNote');if(note)note.textContent=shotsGet(term).length?'左滑查看截图':'当前没有截图';
    return true;
  }
  return false;
}
function aImageRenderShot(term){
  const list=shotsGet(term), img=$('#wmIllusImg'), box=$('#wmIllus'), skel=$('#wmIllusSkel'), cap=$('#wmIllusCap'), more=$('#wmIllusMore'), confirm=$('#wmIllusConfirm');
  if(!list.length||!img||!box)return false;
  aImageSlide={term:String(term||''),kind:'shot',touchX:0,touchY:0};
  wmMemoHide();box.classList.remove('hidden');if(skel)skel.classList.add('hidden');img.classList.add('ok');img.alt='原始截图';img.src=list[0].dataUrl;
  if(cap){cap.textContent='原始截图 1 / '+list.length;cap.removeAttribute('href');}
  if(more)more.classList.add('hidden');if(confirm)confirm.classList.add('hidden');
  const note=$('#aImageSwipeNote');if(note)note.textContent='左滑回到 AI 图';
  return true;
}
function aImageSwipe(dir){
  if(!wmState||!wmState.term)return;
  const term=wmState.term;
  if(dir>0&&aImageSlide.kind==='ai'&&shotsGet(term).length){aImageRenderShot(term);return;}
  if(dir<0&&aImageSlide.kind==='shot'){aImageRenderAi(term);return;}
}
function aImageBindSwipe(){
  const box=$('#wmIllus');if(!box||box.dataset.aSwipeBound)return;box.dataset.aSwipeBound='1';
  const start=e=>{const p=e.touches?e.touches[0]:e;aImageSlide.touchX=p.clientX;aImageSlide.touchY=p.clientY;};
  const end=e=>{const p=e.changedTouches?e.changedTouches[0]:e,dx=p.clientX-aImageSlide.touchX,dy=p.clientY-aImageSlide.touchY;if(Math.abs(dx)<45||Math.abs(dx)<Math.abs(dy)*1.2)return;aImageSwipe(dx<0?-1:1);};
  box.addEventListener('touchstart',start,{passive:true});box.addEventListener('touchend',end,{passive:true});
}
async function aGenerateImage(term,signal){
  if(aRoute()!=='api')return null;
  const image=aiImageConfig();
  if(!image.baseUrl||!image.apiKey||!image.model)throw new Error('请在设置中填写独立的 AI 图片接口地址、Key 和模型');
  const base=image.baseUrl.replace(/\/+$/,'');
  const w=state.words.find(x=>String(x.term||'').toLowerCase()===String(term||'').toLowerCase()), m=w?aMeta(w):{};
  const prompt='为英语表达「'+term+'」生成一张帮助记忆的横向学习插图。语境：'+(m.original||m.purpose||w&&w.definition||'日常真实使用场景')+'。只表现一个自然动作和一个关键物件，画面干净、具体、适合手机查看，不要在图中出现任何文字、字幕、水印或单词。';
  const requestSignal=signal;
  const res=await fetch(base+'/images/generations',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+image.apiKey},body:JSON.stringify({model:image.model,prompt,size:'1024x1024'}),signal:requestSignal});
  if(!res.ok)throw new Error('图片生成 HTTP '+res.status);
  const data=await res.json(),item=data&&data.data&&data.data[0],src=item&&(item.b64_json?'data:image/png;base64,'+item.b64_json:item.url);
  if(!src)throw new Error('图片生成没有返回图片');
  return {src,thumb:src,credit:'AI 生成',createdAt:Date.now()};
}
async function aImageOpen(term,force){
  const t=String(term||'').trim();if(!t)return;
  if(aImageRequestTerm&&aImageRequestTerm!==t)aImageCancel();
  const rec=aImageRecord(t);rec.term=t;
  /* 本地已落地的图优先：固定显示，不依赖网络、不重新搜（force 时才允许走外链强刷） */
  if(!force){
    const blobUrl=await imgLocalUrl(t);
    if(blobUrl){
      wmIllusPaint({term:t,cands:[{src:blobUrl,thumb:blobUrl,credit:''}],idx:0,src:'local-blob'});
      aImageBindSwipe();
      return;
    }
  }
  if(!force&&rec.confirmed&&aImageRenderAi(t)){aImageBindSwipe();return;}
  if(!force&&aImageRenderAi(t)){aImageBindSwipe();return;}
  const photo=typeof photoKey==='function'?photoKey():null;
  if(photo){
    if(force||rec.imgFailAt){wmImgStore(t,{local:rec.local===false?false:rec.local,cands:[],idx:0,prov:photo.prov,confirmed:false});}
    const legacy=window.aLegacyWmIllusLoad;
    if(legacy)await legacy(t);
    aImageBindSwipe();
    const shown=aImageRenderAi(t);if(shown)return;
    const note=$('#aImageSwipeNote');if(note)note.textContent='Pixabay 没有返回图片，可检查 Key 或网络';
    return;
  }
  if(aRoute()!=='api'){
    const legacy=window.aLegacyWmIllusLoad;
    if(legacy)await legacy(t);
    aImageBindSwipe();
    const shown=aImageRenderAi(t);if(shown)return;
    const note=$('#aImageSwipeNote');if(note)note.textContent='可在设置中启用自动图片生成';
    return;
  }
  if(aImageGenerating)return;
  const requestId=++aImageRequestSeq,ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),45000);
  aImageRequestAbort=ctrl;aImageRequestTerm=t;aImageGenerating=true;wmIllusSkeleton();
  try{
    const c=await aGenerateImage(t,ctrl.signal);if(!c)return;
    if(requestId!==aImageRequestSeq||!wmState||String(wmState.term||'').trim()!==t)return;
    const fresh=aImageRecord(t),cands=Array.isArray(fresh.cands)?fresh.cands.slice():[];
    cands.push(c);const next={local:false,cands:cands.slice(-6),idx:Math.max(0,cands.slice(-6).length-1),src:'ai',prov:'ai',confirmed:false};wmImgStore(t,next);aImageRenderAi(t);aImageBindSwipe();
  }catch(e){
    if(e&&e.name==='AbortError')return;
    if(requestId===aImageRequestSeq&&wmState&&String(wmState.term||'').trim()===t){wmIllusFail(t,'AI 图片生成失败 · 点这里重试');toast('AI 图片生成失败：'+(e.message||'请重试'),'warn');}
  }finally{
    clearTimeout(timer);
    if(requestId===aImageRequestSeq){aImageGenerating=false;aImageRequestAbort=null;aImageRequestTerm='';}
  }
}
const aLegacyWmIllusLoad=wmIllusLoad;window.aLegacyWmIllusLoad=aLegacyWmIllusLoad;
wmIllusLoad=async function(term){await aImageOpen(term,false);};
const aLegacyWmIllusPaint=wmIllusPaint;
wmIllusPaint=function(rec){aLegacyWmIllusPaint(rec);aImageSetConfirm(rec);aImageBindSwipe();};
let aStudyMode=true;
let aStudyExamplesExpanded=false;
function aMountStudyCard(){
  const body=$('#wmBody');if(!body)return;
  const def=$('#wmDefinition')&&$('#wmDefinition').closest('.wm-section');
  const coll=$('#wmCollInput')&&$('#wmCollInput').closest('.wm-section');
  const examples=$('#wmExamples')&&$('#wmExamples').closest('.wm-section');
  const tags=$('#wmTags')&&$('#wmTags').closest('.wm-section');
  const master=$('#wmMaster')&&$('#wmMaster').closest('.wm-section');
  const move=$('#wmMoveRow');
  if(def)def.classList.add('a-study-definition');
  if(coll)coll.classList.add('a-study-advanced');
  if(examples)examples.classList.add('a-study-examples');
  if(tags)tags.classList.add('a-study-tags');
  if(master)master.classList.add('a-study-master');
  if(move)move.classList.add('a-study-move');
  if(!$('#aStudyBar')){
    const bar=document.createElement('div');bar.id='aStudyBar';bar.className='a-study-bar';bar.innerHTML='<div class="a-study-bar-copy"><div class="a-study-bar-title">学习卡片</div><div class="a-study-bar-note" id="aStudyModeNote">先看图、释义和例句，再决定是否整理</div></div><button class="a-study-more" id="aStudyMore" type="button">更多例句</button><button class="a-study-edit" id="aStudyEdit" type="button">编辑整理</button>';
    body.insertBefore(bar,body.firstChild);
    $('#aStudyEdit').onclick=()=>aSetStudyMode(!aStudyMode);
    $('#aStudyMore').onclick=()=>aSetStudyExamplesExpanded(!aStudyExamplesExpanded);
  }
}
function aSetStudyExamplesExpanded(show){
  aStudyExamplesExpanded=!!show;
  const modal=$('#wordModal'),button=$('#aStudyMore');
  if(modal)modal.classList.toggle('a-study-show-all',aStudyExamplesExpanded);
  if(button)button.textContent=aStudyExamplesExpanded?'收起例句':'更多例句';
}
function aSetStudyMode(study){
  aStudyMode=!!study;const modal=$('#wordModal'),button=$('#aStudyEdit'),note=$('#aStudyModeNote');
  if(modal)modal.classList.toggle('a-study-mode',aStudyMode);
  if(button)button.textContent=aStudyMode?'编辑整理':'返回学习卡片';
  if(aStudyMode)aSetStudyExamplesExpanded(false);else aSetStudyExamplesExpanded(true);
  if(note)note.textContent=aStudyMode?'先看图、释义和例句，再决定是否整理':'正在编辑完整词条，保存后可返回学习卡片';
}
function aApplyStudyMode(){aMountStudyCard();aSetStudyMode(true);}
function aRefreshSettings(){
  const route=$('#aRoute');if(route)route.value=aRoute();
  aiProviderRefreshFields();
  ['stBase','stKey','stModel'].forEach(id=>{const el=$('#'+id);if(el&&el.closest('.st-field'))el.closest('.st-field').hidden=aRoute()!=='api';});
  $$('#stgAi .st-presets').forEach(el=>el.hidden=true);
  const el=$('#stgSumAi');if(el)el.textContent=aRoute()==='chatgpt'?'ChatGPT 往返':aiProviderCfg().label;
  aiImageRefreshFields();
  ttsRefreshSettings();
}
function ttsRefreshSettings(){
  const cfg=volcTtsConfig();
  const key=$('#stTtsKey'),speaker=$('#stTtsSpeaker'),relay=$('#stTtsRelay'),rate=$('#stTtsRate'),pitch=$('#stTtsPitch'),status=$('#stTtsStatus');
  if(key&&document.activeElement!==key)key.value=cfg.apiKey||'';
  if(speaker&&document.activeElement!==speaker)speaker.value=cfg.speaker||VOLC_TTS_DEFAULT.speaker;
  if(relay&&document.activeElement!==relay)relay.value=cfg.relayUrl||'';
  if(rate&&document.activeElement!==rate)rate.value=String(cfg.speechRate||0);
  if(pitch&&document.activeElement!==pitch)pitch.value=String(cfg.pitchRate||0);
  if(status)status.textContent=volcTtsLastError?'豆包失败，已回退：'+volcTtsLastError:(volcTtsReady()?'已配置，英文朗读时会生成并缓存':'还未配置');
}
async function ttsTest(){
  const key=$('#stTtsKey'),speaker=$('#stTtsSpeaker'),relay=$('#stTtsRelay'),rate=$('#stTtsRate'),pitch=$('#stTtsPitch');
  const apiKey=String(key&&key.value||'').trim(),voice=String(speaker&&speaker.value||'').trim(),relayUrl=String(relay&&relay.value||'').trim();
  if(!voice||(!apiKey&&!relayUrl)){toast('先填写豆包 API Key 或服务端中转地址，并填写音色 ID','warn');return;}
  volcTtsSave({apiKey,speaker:voice,relayUrl:String(relay&&relay.value||'').trim(),speechRate:Number(rate&&rate.value)||0,pitchRate:Number(pitch&&pitch.value)||0});
  const ok=await playVolcAudio('Could you say that again?','en-US');
  toast(ok?'豆包试听已开始，后续会复用缓存':'豆包请求失败，已回退原朗读：'+(volcTtsLastError||'请检查配置'),'warn');
  ttsRefreshSettings();
}
const aOriginalSettings=openSettings;
openSettings=function(){aOriginalSettings();aRefreshSettings();};
const aOriginalSettingsUI=syncSettingsUI;
syncSettingsUI=function(){aOriginalSettingsUI();aRefreshSettings();};
testConn=async function(){if(aRoute()==='chatgpt'){toast('无需接口连接：复制任务到 ChatGPT，再粘回 JSON 即可');return;}if(!aAiReady()){toast('请保存 OpenAI 官方接口地址与 Key 后再试','warn');return;}try{const r=await aiCall([{role:'user',content:'仅输出 JSON：{"ok":true}'}]);toast(r.ok?'连接成功':'已收到响应');}catch(e){toast(e.message,'warn');}};
aiGuideHtml=function(msg){return '<div class="empty-state">'+esc(msg)+'<p>ChatGPT 往返无需 Key；自动模式需要 OpenAI 官方 API 地址、Key 和可用模型名称。</p><button class="btn" id="aiRetry">重试</button><button class="btn primary" id="aiGotoSettings">去设置</button></div>';};
// Old remote-sync settings are retained, but no background upload or merge is
// performed by a newly opened A version. Manual legacy sync remains available.
scheduleSync=function(){};
syncOnBoot=function(){};
exportData=aDownloadBackup;
importData=aImportFile;
function aInit(){
  aData=aRead(A_KEY,{words:{},attempts:[]});if(!aData.words||typeof aData.words!=='object')aData.words={};if(!Array.isArray(aData.attempts))aData.attempts=[];
  const guideButton=document.createElement('button');guideButton.id='aGuideOpen';guideButton.type='button';guideButton.className='a-guide-hero';guideButton.innerHTML='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg><span class="agh-copy"><b>使用小手册</b><small>5 步上手，不知道点哪就看它</small></span>';guideButton.onclick=()=>$('#aGuide').classList.add('show');const sideNav=$('#sideNav');if(sideNav&&!$('#aGuideOpen'))sideNav.insertBefore(guideButton,sideNav.firstChild);
  $('#aGuideClose').onclick=()=>$('#aGuide').classList.remove('show');$('#aGuide').addEventListener('click',e=>{if(e.target.id==='aGuide')$('#aGuide').classList.remove('show');});
  /* 手机端表达库筛选抽屉：触发、遮罩、关闭 */
  $('#wordFilterTrigger').onclick=wfOpenSheet;
  $('#wordFilterClose').onclick=wfCloseSheet;
  $('#wordFilterMask').onclick=wfCloseSheet;
  $('#aBridgeClose').onclick=()=>{const job=aBridgeJob;aBridgeJob=null;$('#aBridge').classList.remove('show');if(job)job.reject(new Error('已取消本次 ChatGPT 任务，内容没有改动'));};
  $('#aCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('#aPrompt').value);toast('任务已复制，打开 ChatGPT 粘贴');}catch(_){$('#aPrompt').focus();$('#aPrompt').select();toast('请长按任务框复制','warn');}};
  $('#aApply').onclick=()=>{if(!aBridgeJob)return;try{const value=aValidateResult(aParseResult($('#aResult').value),aBridgeJob.prompt);const job=aBridgeJob;aBridgeJob=null;$('#aBridge').classList.remove('show');job.resolve(value);}catch(e){$('#aBridgeError').textContent='还不能使用：'+e.message;}};
  $('#aRecallClose').onclick=()=>{$('#aRecall').classList.remove('show');render();};const batchCloseBtn=$('#aBatchClose'),batchPanel=$('#aBatch');if(batchCloseBtn)batchCloseBtn.onclick=()=>batchClose();if(batchPanel)batchPanel.addEventListener('click',e=>{if(e.target.id==='aBatch')batchClose();});$('#aBackupClose').onclick=()=>$('#aBackup').classList.remove('show');$('#aExport').onclick=aDownloadBackup;$('#aImport').onchange=e=>{aImportFile(e.target.files[0]);e.target.value='';};
  ['aPurpose','aOwn','aOriginal','aSource','aTime'].forEach(id=>$('#'+id).addEventListener('input',()=>{if(wmState&&wmState.aMetaKey)aPut(wmState.aMetaKey,aFieldValues());}));
  const cap=$('#wmIllusCap');if(cap&&!$('#aImageSwipeNote')){const note=document.createElement('span');note.id='aImageSwipeNote';note.className='illus-swipe-note';note.textContent='右滑查看截图';cap.append(note);}
  const confirm=$('#wmIllusConfirm');if(confirm){confirm.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();if(!wmState)return;const rec=aImageRecord(wmState.term),c=aImageCurrent(wmState.term);if(!c)return;rec.term=wmState.term;rec.confirmed=true;wmImgStore(wmState.term,rec);aImageSetConfirm(rec);toast('图片已确定，之后打开会保持这一张','ok');},{capture:true});}
  const more=$('#wmIllusMore');
  if(more)more.addEventListener('click',()=>{
    if(!wmState||aImageGenerating)return;
    const term=wmState.term,rec=aImageRecord(term);
    if(rec.confirmed)return;
    if(rec.prov!=='ai'&&rec.src!=='ai'&&Array.isArray(rec.cands)&&rec.cands.length>1){
      rec.idx=((rec.idx||0)+1)%rec.cands.length;
      wmImgStore(term,rec);
      aImageRenderAi(term);
      return;
    }
    aImageOpen(term,true);
  });
  $('#aIllustrate').onclick=async()=>{try{const memo=await aiCall([{role:'user',content:'为英语表达 '+wmState.term+' 设计一个简单记忆画面。只输出 JSON：{"emoji":"一个emoji","scene":"一句中文画面提示"}'}]);if(!memo.scene)throw new Error('缺少画面描述');wmMemoPaint(memo,wmState.term);}catch(e){toast(e.message,'warn');}};
  const aiBody=$('#stgAi .st-g-body');const route=document.createElement('div');route.className='st-field';route.innerHTML='<label for="aRoute">AI 使用方式</label><select id="aRoute"><option value="api">API 自动（DeepSeek 默认）</option><option value="chatgpt">ChatGPT 往返（Plus 额度）</option></select><label for="aProvider" style="margin-top:10px">API 提供商</label><select id="aProvider"><option value="deepseek">DeepSeek（默认）</option><option value="openai">OpenAI GPT（备用）</option></select><p class="a-note">DeepSeek 默认使用 deepseek-flash。GPT 需要自己的 OpenAI API Key。ChatGPT Plus 只在复制往返模式里使用。</p>';
  aiBody.prepend(route);$('#aRoute').onchange=()=>{aStore(A_PREF_KEY,$('#aRoute').value);aRefreshSettings();};
  const lookBody=$('#stgLook .st-g-body');if(lookBody&&!$('#stDialogueThreshold')){const pref=document.createElement('div');pref.className='st-field';pref.id='stDialogueThreshold';pref.innerHTML='<label for="stDialogueThresholdSelect">复习后 AI 对话频率</label><div class="st-inline"><select id="stDialogueThresholdSelect"><option value="3">每 3 个词询问</option><option value="5">每 5 个词询问</option><option value="10">每 10 个词询问</option><option value="custom">自定义</option></select><input id="stDialogueThresholdCustom" type="number" min="3" max="10" step="1" placeholder="3—10" style="max-width:92px"></div><p class="a-note">达到数量后由你选择继续复习，或用刚刚的词练 AI 对话。</p>';lookBody.append(pref);const select=$('#stDialogueThresholdSelect'),custom=$('#stDialogueThresholdCustom'),sync=()=>{const n=dialogueThreshold(),preset=[3,5,10].includes(n)?String(n):'custom';select.value=preset;custom.value=preset==='custom'?String(n):'';custom.hidden=preset!=='custom';};select.onchange=()=>{if(select.value!=='custom'){saveDialogueThreshold(select.value);sync();toast('已设置为每 '+dialogueThreshold()+' 个词询问');}else{custom.hidden=false;custom.focus();}};custom.onchange=()=>{saveDialogueThreshold(custom.value);sync();toast('已设置为每 '+dialogueThreshold()+' 个词询问');};sync();}
  $('#aProvider').onchange=()=>{aiProviderSaveFields();aiProviderSave({name:$('#aProvider').value});aRefreshSettings();};
  ['stBase','stKey','stModel'].forEach(id=>$('#'+id).addEventListener('input',aiProviderSaveFields));
  $('#stSave').addEventListener('click',aiProviderSaveFields,{capture:true});
  const image=document.createElement('div');image.className='st-field';image.id='stAiImage';image.hidden=true;image.innerHTML='<label>高级 AI 图片生成（可选）</label><input id="stImageBase" placeholder="支持图片生成的接口地址，例如 https://api.openai.com/v1" autocomplete="off"><input id="stImageKey" type="password" placeholder="图片接口 API Key" autocomplete="off"><input id="stImageModel" placeholder="图片模型，例如 gpt-image-1" autocomplete="off"><p class="a-note">当前默认使用 Pixabay。只有需要真正的 AI 生图时才配置这里，DeepSeek 文本接口不能直接生成图片。</p>';aiBody.append(image);aiImageRefreshFields();
  ['stImageBase','stImageKey','stImageModel'].forEach(id=>$('#'+id).addEventListener('input',aiImageSaveFields));
  const tts=document.createElement('div');tts.className='st-field';tts.id='stVolcTts';tts.innerHTML='<label>豆包语音合成 2.0（单词和例句）</label><input id="stTtsKey" type="password" placeholder="直连时粘贴豆包 API Key，中转模式可留空" autocomplete="off"><input id="stTtsSpeaker" placeholder="音色 ID，例如 zh_female_vv_uranus_bigtts（Vivi 2.0）" autocomplete="off"><input id="stTtsRelay" placeholder="可选：服务端中转地址，例如 https://你的域名/tts" autocomplete="off"><div class="st-inline"><input id="stTtsRate" type="number" min="-50" max="100" step="1" value="0" placeholder="语速"><input id="stTtsPitch" type="number" min="-12" max="12" step="1" value="0" placeholder="音调"><button class="btn" id="stTtsTest" type="button">试听</button></div><div class="bk-note" id="stTtsStatus">还未配置</div><p class="a-note">填写中转地址后，网页只请求中转服务，豆包 API Key 保存在服务端。未填写中转地址时继续直连豆包。</p>';
  aiBody.append(tts);ttsRefreshSettings();
  ['stTtsKey','stTtsSpeaker','stTtsRelay','stTtsRate','stTtsPitch'].forEach(id=>$('#'+id).addEventListener('input',()=>{const el=$('#'+id);volcTtsSave({apiKey:$('#stTtsKey').value.trim(),speaker:$('#stTtsSpeaker').value.trim(),relayUrl:$('#stTtsRelay').value.trim(),speechRate:Number($('#stTtsRate').value)||0,pitchRate:Number($('#stTtsPitch').value)||0});ttsRefreshSettings();}));
  $('#stTtsTest').addEventListener('click',ttsTest);
  const dataButton=document.createElement('button');dataButton.className='btn';dataButton.textContent='完整备份／安全迁移';dataButton.onclick=aOpenBackup;$('#settingsModal .st-body').prepend(dataButton);
  $$('#stgAi .st-presets').forEach(el=>el.style.display='none');
  const syncBody=$('#stgSync .st-g-body');if(syncBody){const note=document.createElement('p');note.className='a-note';note.textContent='A 版默认暂停旧同步的自动上传与启动合并，以保留本机内容。完整备份覆盖截图、写作和学习记录；旧同步码仅搬运部分主数据，不是完整备份。';syncBody.prepend(note);}
  $('#stgSync').hidden=true;/* 2026-11-08 恢复：单词配图入口重新显示，Pixabay 实测可达（不需要节点） */
  const legacyNotes=$$('#settingsModal .st-note');legacyNotes.forEach(el=>{el.textContent='A 版默认使用 ChatGPT 往返；自动模式仅使用 OpenAI 官方 API，单独计费。原有同步配置保留，但新版不自动上传或合并。跨设备请使用完整备份。';});
  const help=$('#settingsModal .st-help');if(help)help.innerHTML='<b>AI：</b>默认把任务复制到 ChatGPT，练完导回结果；套餐和模型由你的 ChatGPT 账号决定。自动调用仅支持你自己配置的 OpenAI 官方 API，费用单独结算。<br><b>图片：</b>当前默认使用 Pixabay，独立 AI 图片配置属于隐藏的高级功能，通常不需要填写。<br><b>数据：</b>表达仍在本机浏览器，旧键名保持兼容；新增学习记录独立保存。跨地址使用先导出备份。<br><b>同步：</b>保留旧配置，默认暂停自动上传与启动合并；截图、写作和新学习记录请用完整备份迁移。<br><b>跟读：</b>保留播放、录音与回听；分数只作文本匹配、节奏和音量参考。';
  $('#stModel').placeholder='填写你在 OpenAI API 中可用的模型名称';
  aRefreshSettings();
}

