// Build the commercial Pages bundle first. SVOCAB_BROWSER can override the Chromium executable.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const executable=process.env.SVOCAB_BROWSER||[
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
assert(executable,'请用 SVOCAB_BROWSER 指定本机 Chromium 浏览器');
const pageUrl=new URL('../dist/pages/index.html',import.meta.url);
const localFile=process.argv.includes('--file');
const page=await readFile(pageUrl);
const tempRoot=await realpath(tmpdir());
const profile=await mkdtemp(join(tempRoot,'svocab-review-browser-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){
  for(let i=0;i<100;i++){
    const value=await check();
    if(value) return value;
    await wait(100);
  }
  throw new Error('等待浏览器或页面超时');
}

const server=createServer((req,res)=>{
  if(req.url!=='/') { res.writeHead(404).end(); return; }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(page);
});
let browser, socket;
try{
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const url=localFile?pageUrl.href:'http://127.0.0.1:'+server.address().port+'/';
  browser=spawn(executable,[
    '--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--remote-debugging-port=0','--user-data-dir='+profile,localFile?url:'about:blank'
  ],{stdio:'ignore',windowsHide:true});
  const debuggerPort=await until(async()=>{
    const value=await readFile(join(profile,'DevToolsActivePort'),'utf8').catch(()=>null);
    return value?.split('\n')[0].trim();
  });
  const targets=await (await fetch('http://127.0.0.1:'+debuggerPort+'/json/list')).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await once(socket,'open');
  let sequence=0;
  const requests=new Map();
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data),pending=requests.get(message.id);
    if(!pending) return;
    clearTimeout(pending.timeout);
    requests.delete(message.id);
    if(message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  });
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timeout=setTimeout(()=>{
      requests.delete(id);
      reject(new Error(method+' 超时'));
    },localFile?20000:6000);
    requests.set(id,{resolve,reject,timeout});
    socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async (fn)=>{
    const response=await cdp('Runtime.evaluate',{
      expression:'('+fn.toString()+')()',awaitPromise:true,returnByValue:true
    });
    if(response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
    return response.result.value;
  };
  let opened=false;
  async function loadPage(){
    if(opened) await cdp('Page.reload');
    else if(!localFile) await cdp('Page.navigate',{url});
    opened=true;
    await until(()=>evaluate(()=>document.readyState==='complete'&&typeof renderFlash==='function'&&!window.reviewFlowReady).catch(()=>false));
    await evaluate(()=>{
      window.reviewFlowReady=true;
      window.check=(value,label)=>{ if(!value) throw new Error(label); };
      window.click=selector=>{
        const button=document.querySelector(selector);
        check(button&&!button.disabled,'按钮不可用 '+selector);
        button.click();
      };
      window.grade=score=>{ click('#flashCard'); click('[data-grade="'+score+'"]'); };
      window.openReview=()=>{ ui.mode='today'; render(); click('#thStart'); };
      window.summary=()=>!!document.querySelector('#rvSpeakGo');
      window.nextCard=()=>ui.flash.ids[ui.flash.idx];
      window.srsSnapshot=()=>JSON.stringify(state.words.map(w=>w.srs));
    });
  }

  if(process.argv.includes('--first-shot')){
    const {testFirstShot}=await import('./test-first-shot.mjs');
    await testFirstShot({loadPage,evaluate,cdp});
  }else if(process.argv.includes('--shared-review')){
    const {testSharedReview}=await import('./test-shared-review.mjs');
    await testSharedReview({loadPage,evaluate,cdp});
  }else if(process.argv.includes('--first-own')){
    const {testFirstOwn}=await import('./test-first-own.mjs');
    await testFirstOwn({loadPage,evaluate,cdp});
  }else if(process.argv.includes('--first-review')){
    const {testFirstReview}=await import('./test-first-review.mjs');
    await testFirstReview({loadPage,evaluate,cdp});
  }else{
  await loadPage();
  await evaluate(()=>{
    const now=Date.now();
    state.words=['anchor','notice','confirm','collect','sort','prepare','return','choose','finish','record'].map((term,i)=>({
      id:term,term,definition:'测试释义',examples:[],tags:[],notes:[],createdAt:now,
      srs:{box:1,due:now-100000+i*1000,last:i<5?now-200000:0,reps:i<5?1:0,lapses:0}
    }));
    save(true);
    openReview();
    check(nextCard()==='anchor','首卡应为最早到期的旧词');
    grade(0);
    check(nextCard()==='notice','首卡评分后下一张');
  });
  await loadPage();
  await evaluate(()=>{
    openReview();
    check(nextCard()==='notice'&&state.words[0].srs.reps===2,'中途刷新应恢复第二张且只评分一次');
    grade(1);
    grade(1);
    grade(2);
    grade(2);
    check(summary()&&document.querySelectorAll('[data-speak]').length===3,'总结应有三个难词');
    click('[data-speak="confirm"]');
  });
  await loadPage();
  const passed=await evaluate(async()=>{
    openReview();
    check(summary()&&!document.querySelector('[data-speak="confirm"]').checked,'刷新后应恢复总结和勾选');
    const before=srsSnapshot(), round=JSON.stringify(ui.flash.ids);
    const settle=async()=>{ for(let i=0;i<10;i++) await Promise.resolve(); };
    aAiReady=()=>true;
    aiFindRecentSession=()=>null;
    aiSchedulePrefetch=()=>{};
    aiSuggestScenes=async()=>({
      scenes:[aiState.allTermIds.slice(0,2),aiState.allTermIds.slice(2)].filter(ids=>ids.length)
        .map((wordIds,i)=>({title:'测试场景 '+(i+1),desc:'本机模拟',wordIds}))
    });
    let generationFails=false, reviewFails=false;
    aiCreateValidatedDialogue=async()=>{
      if(generationFails) throw new Error('模拟生成失败');
      return aiState.termIds.map(wordId=>({who:'YOU',wordId,promptCn:'请用英文回答'}));
    };
    aiJudge=async()=>{
      if(reviewFails) throw new Error('模拟批改失败');
      return {standard:'A sample reply.',fit:'模拟反馈'};
    };
    const modalOpen=()=>document.querySelector('#aiModal').classList.contains('show');
    const praised=()=>document.querySelector('#praise').classList.contains('show');
    const open=async()=>{ click('#rvSpeakGo'); await settle(); check(modalOpen(),'口语应打开'); };
    const scene=async(index=0)=>{ click('[data-scene="'+index+'"]'); await settle(); };
    const answer=async()=>{
      document.querySelector('#aiInput').value='A sample reply.';
      click('#aiSend');
      await settle();
    };
    const interrupted=()=>{
      check(!modalOpen()&&summary()&&!praised(),'中断应回到原总结且不弹鼓励');
      check(JSON.stringify(ui.flash.ids)===round,'中断不应开启新一轮');
      check(!document.querySelector('[data-speak="confirm"]').checked,'中断应保留勾选');
      check(aiSessionDoc.status==='interrupted','未完成的口语不能记为已完成');
    };
    await open(); click('#aiClose2'); interrupted();
    await open(); await scene(); await answer();
    check(aiState.phase==='review'&&aiState.turnIndex===0,'已收到第一句反馈');
    click('#aiClose2'); interrupted();
    generationFails=true;
    await open(); await scene();
    check(aiState.phase==='error','应走真实的生成失败分支');
    click('#aiClose'); interrupted();
    generationFails=false; reviewFails=true;
    await open(); await scene(); await answer();
    check(document.querySelector('#aiInput').value==='A sample reply.','批改失败应恢复输入');
    click('#aiClose'); interrupted();
    reviewFails=false;
    click('[data-speak="confirm"]');
    await open(); await scene(1); await answer(); click('#aTurnUsed'); await settle();
    check(modalOpen()&&aiState.sceneIndex===0&&!praised(),'先做最后一场也要补做还没练的词');
    let prefetched=0;
    aiCreateDialogueFor=async()=>{ prefetched++; return []; };
    aiPrefetchNextScene();
    check(prefetched===0,'不要预取已练完的场景');
    await answer(); click('#aTurnUsed'); await settle();
    check(modalOpen()&&aiState.turnIndex===1,'第一句确认后应进入同场第二句');
    await answer(); click('#aTurnNeedsWork'); await settle();
    check(!modalOpen()&&!summary()&&praised(),'最后一句确认后应庆祝并打开下一轮');
    check(aiSessionDoc.status==='completed'&&aiSessionDoc.turns.length===3,'三个口语结果都应记录一次');
    check(srsSnapshot()===before,'口语和刷新不能改变词卡到期时间或评分次数');
    check(JSON.stringify(ui.flash.ids)!==round&&ui.flash.idx===0,'最终应在新一轮首卡');
    grade(1);
    while(nextCard()) grade(2);
    check(document.querySelectorAll('[data-speak]').length===1,'下一轮只设一个口语目标');
    await open(); await scene(); await answer();
    check(aiState.phase==='review'&&!aiState.multiTurn,'应正常收到单词口语反馈');
    click('#aiClose2');
    check(!modalOpen()&&aiSessionDoc.status==='completed','单词口语仍可用完成按钮结束');
    return true;
  });
  assert.equal(passed,true);
  console.log('浏览器回归通过：两处原生刷新、勾选恢复、四种中断、跨场景和单词完成、预取及卡片间隔。');
  }
}finally{
  socket?.close();
  if(browser&&browser.exitCode===null&&browser.signalCode===null){
    const closed=once(browser,'close');
    browser.kill();
    await closed;
  }
  server.close();
  const checkedProfile=await realpath(profile);
  assert(dirname(checkedProfile)===tempRoot&&basename(checkedProfile).startsWith('svocab-review-browser-'));
  await rm(checkedProfile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
