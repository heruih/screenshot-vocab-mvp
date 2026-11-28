export async function testSharedReview({loadPage,evaluate,cdp}){
  if(process.argv.includes('--mobile')){
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await cdp('Emulation.setTouchEmulationEnabled',{enabled:true});
  }
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.reviewErrors=[];
    window.addEventListener('error', event=>{if(event.error) reviewErrors.push(event.message);});
    window.addEventListener('unhandledrejection', event=>reviewErrors.push(String(event.reason)));
  `});
  await loadPage();
  await evaluate(()=>{
    const terms=['anchor','notice','confirm','put off','choose'];
    const sentences=['We can anchor in the bay.','Did you notice the change?','Please confirm your seat before Friday.','We put off the meeting until Friday.','You can choose the date yourself.'];
    const now=Date.now();
    state.words=terms.map((term,i)=>({
      id:term,term,definition:'测试释义',examples:[{en:sentences[i],cn:'中文意思'}],tags:[],notes:[],
      createdAt:now,srs:{box:3,due:now-50000+i*1000,last:i<3?now-60000:0,reps:i<3?1:0,lapses:0}
    }));
    save(true);
    openReview();
    check(nextCard()==='anchor'&&$('#flashCard')&&$('.rv-stats').textContent.includes('0 / 5'),'新一轮默认闪卡，进度从零开始');
    check(!$('.rv-stats').textContent.includes('已掌握'),'页顶去掉已掌握');
    grade(2);
    grade(1);
    check(nextCard()==='confirm'&&$('.rv-stats').textContent.includes('2 / 5'),'闪卡先完成两个词');
    click('[data-review-mode="recall"]');
    check(nextCard()==='put off'&&$('#reviewRecallAttempt'),'从已露出词的闪卡切换时，立即练没见过的题');
    check(!$('.recall-sentence').textContent.toLowerCase().includes('put off'),'英文题面隐藏短语');
    const input=$('#reviewRecallAttempt');
    input.value='  PUT    off ';
    input.dispatchEvent(new Event('input'));
  });

  await loadPage();
  await evaluate(()=>{
    openReview();
    check(nextCard()==='put off'&&$('#reviewRecallAttempt').value==='  PUT    off ','恢复同一道题和输入');
    check($('.rv-stats').textContent.includes('2 / 5'),'切换和刷新均不额外计数');
    click('#reviewRecallForm button[type="submit"]');
    check(!document.querySelector('[data-grade="2"]').disabled,'独立补对才能评记住了');
    const saveBefore=aStore;
    aStore=(key,value)=>key===LS_KEY?false:saveBefore(key,value);
    click('[data-grade="2"]');
    aStore=saveBefore;
    check(state.words.find(w=>w.id==='put off').srs.reps===0&&nextCard()==='put off','保存失败时保留题面并撤回评分');
    click('[data-grade="2"]');
    check(nextCard()==='choose'&&$('#reviewRecallAttempt'),'下一题沿用场景回想');
    click('#reviewRecallHint');
    const input=$('#reviewRecallAttempt');
    input.value='choose';
    input.dispatchEvent(new Event('input'));
    click('#reviewRecallForm button[type="submit"]');
    check(document.querySelector('[data-grade="2"]').disabled,'使用提示后答对也不能算独立记住');
    click('[data-review-mode="flash"]');
    check(nextCard()==='choose'&&!$('#flashCard'),'看过答案后先完成当前题');
  });

  await loadPage();
  await evaluate(()=>{
    openReview();
    check(nextCard()==='choose'&&document.querySelector('[data-grade="2"]').disabled,'刷新后答案与提示状态仍锁定');
    click('[data-grade="1"]');
    check(nextCard()==='confirm'&&$('#flashCard')&&$('.rv-stats').textContent.includes('4 / 5'),'切回闪卡完成第五个词');
    grade(0);
    check($('.rv-stats').textContent.includes('5 / 5')&&new Set(ui.flash.ids).size===5,'两种方式合计五个不同的词');
    check($$('[data-speak]').map(el=>el.dataset.speak).join(',')==='confirm,notice,choose','AI 仍按忘了、有点难的顺序荐词');
    const byWord=aRead(SHARED_REVIEW_KEY,{}).evidence;
    check(byWord['put off'].recall.correct&&!byWord['put off'].recall.hinted&&byWord.choose.recall.hinted,'两种方式的结果和提示分别留存');
    check(!aMeta(state.words.find(w=>w.id==='put off')).lastOutput,'补词不算作真实场景下独立表达');
    const day=86400000;
    state.words.forEach((w,i)=>{
      check(w.srs.reps===(i<3?2:1),'每个词只累计一次评分');
      const interval={anchor:7*day,notice:3*day*.6,confirm:600000,'put off':7*day,choose:3*day*.6}[w.id];
      check(w.srs.due-w.srs.last===interval,'三档都沿用原来的间隔规则');
    });
    // Only the successfully retrieved flashcard is now due.
    state.words[0].srs.due=Date.now()-1;
    save(true);
    click('#rvAgain');
    check(nextCard()==='anchor'&&$('#reviewRecallAttempt'),'曾独立记住的闪卡到期时可默认补词');
    click('#reviewRecallReveal');
    check(document.querySelector('[data-grade="2"]').disabled&&document.querySelector('[data-grade="1"]').disabled,'空着看答案只能记忘了');
    click('[data-grade="0"]');
    const evidence=aRead(SHARED_REVIEW_KEY,{}).evidence.anchor;
    check(evidence.flash.grade===2&&evidence.recall.grade===0,'同一词保留两种最近成绩');
    check(!window.reviewErrors?.length,'控制台没有页面异常');
  });

  await evaluate(()=>{
    const word=state.words[0];
    word.examples=[{en:'The anchorage is near this harbour.'}];
    word.srs.due=Date.now()-1;
    const legacy=JSON.stringify([{id:word.id,reps:word.srs.reps}]);
    localStorage.removeItem(SHARED_REVIEW_KEY);
    localStorage.setItem(REVIEW_ROUND_KEY,legacy);
    save(true);
    ui.mode='today';
    render();
    click('[data-hq="recall"]');
    check($('#flashCard')&&$('.review-mode-note').textContent.includes('暂无可用例句'),'例句缺失时回到同一词的闪卡');
    check($('.rv-stats').textContent.includes('0 / 1')&&nextCard()===word.id,'回退不会自动吃掉进度');
    check(localStorage.getItem(REVIEW_ROUND_KEY)===legacy,'读旧轮次时保留旧存储');
  });
  console.log('混合复习通过：2 闪卡＋2 回想＋1 闪卡、刷新续接、三档间隔、保存失败、例句回退及旧轮兼容。');
}
