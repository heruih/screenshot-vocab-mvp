export async function testFirstReview({loadPage,evaluate,cdp}){
  if(process.argv.includes('--mobile')){
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await cdp('Emulation.setTouchEmulationEnabled',{enabled:true});
  }
  const waitFor=async(test)=>{
    for(let i=0;i<80;i++){
      if(await evaluate(test))return;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    throw new Error('等待首轮复习超时 '+test.toString());
  };
  await loadPage();
  await evaluate(()=>{
    firstGuideSave({shot:'done',note:'done',shotNoteId:'guide-note',sampleIds:[]});
    if($('#personaModal').classList.contains('show'))click('#personaSkip');
    const noteRef={noteId:'guide-note',noteTitle:'练习'};
    upsertWord({term:FIRST_SHOT_TERM,examples:[{en:FIRST_SHOT_SENTENCE}],notes:[noteRef]});
    upsertWord({term:FIRST_NOTE_TERM,examples:[{en:FIRST_NOTE_SENTENCE,sense:'示例'}],notes:[noteRef]});
    ['anchor','collect','prepare','finish'].forEach(term=>upsertWord({term,definition:'释义'}));
    check(firstReviewWords().length===4,'已在线上的示例词也不能算进 5 个');
    const pending=upsertWord({term:'pending-word'});aPut(pending.id,{stage:'pending'});
    check(firstReviewWords().length===4,'待整理词不触发引导');
    save();render();
  });
  await new Promise(resolve=>setTimeout(resolve,80));
  await evaluate(()=>{
    check(!firstGuideStep&&!firstReviewState.round,'4 个真实词不触发');
    const word=upsertWord({term:'return',definition:'返回'});
    save();render();openWordModal(word.term,null,null,word);
    window.lastWordId=word.id;
  });
  await new Promise(resolve=>setTimeout(resolve,80));
  await evaluate(()=>{
    check(!firstGuideStep&&!firstReviewState.round,'先让用户看完第五个词的卡片');
    click('#wmClose');
  });
  await waitFor(()=>firstGuideStep==='firstFlip');
  await evaluate(()=>{
    check(ui.flash.round.length===5&&ui.flash.ids.includes(lastWordId),'第 5 个真实词触发五词首轮');
    click('[data-tab="list"]');check(ui.mode==='flash','首轮亮区外不能点');
    click('#flashCard');click('[data-grade="1"]');
    check(firstGuideStep==='firstFlip'&&ui.flash.idx===1,'先翻面，再评级');
  });
  await loadPage();
  await waitFor(()=>firstGuideStep==='firstFlip');
  await evaluate(()=>{
    check(ui.flash.idx===1,'刷新后接续且不重复评分');
    check(ui.flash.round[0].grade===1,'刷新后找回评级');
    click('#flashCard');click('[data-grade="0"]');
    for(let i=0;i<3;i++){click('#flashCard');click('[data-grade="2"]');}
    check(firstGuideStep==='firstSpeak'&&$('#firstReviewWord').value===ui.flash.ids[1],'多难词时优先推荐忘了');
    const choose=$('#firstReviewWord');
    choose.value=ui.flash.ids[2];choose.dispatchEvent(new Event('change',{bubbles:true}));
    check(firstReviewState.choice===ui.flash.ids[2],'可以把推荐词换成复习过的另一个词');

    // 练习走原有对话、提交、反馈与关闭入口。网络结果受控，避免正式额度消耗。
    aAiReady=()=>true;
    aiCreateValidatedDialogue=async()=>[
      {who:'AI',en:'What did you do?',cn:'你做了什么？'},
      {who:'YOU',promptCn:'我准备了报告。',wordId:ui.flash.ids[2]}
    ];
    aiJudge=async()=>{throw new Error('模拟网络错误');};
    click('#firstReviewSpeak');
  });
  await waitFor(()=>firstGuideStep==='firstAiInput');
  await evaluate(()=>{
    const input=$('#aiInput');
    input.value='I prepared the report.';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    check(firstGuideStep==='firstAiSend','输入就绪才指向提交');
    click('#aiSend');
  });
  await waitFor(()=>firstGuideStep==='firstAiSend'&&$('#aiInput').value==='I prepared the report.');
  await evaluate(()=>{
    check(firstReviewState.phase==='dialogue','失败保留答案且不标记完成');
    aiJudge=async()=>({standard:'I prepared the report.',fit:'表达自然',pitfalls:[]});
    click('#aiSend');
  });
  await waitFor(()=>firstGuideStep==='firstAiDone');
  await evaluate(()=>{
    check(firstReviewState.phase==='feedback'&&state.aiLog[0].attempt==='I prepared the report.','成功批改后记录反馈');
    click('#aiClose2');
    check(firstGuideStep==='firstEnd','对话完成返回首轮复习页');
    click('#firstReviewEnd');
    check(firstReviewState.phase==='done'&&!firstGuideStep&&ui.mode==='today','完成后正常返回首页');
  });
  await loadPage();
  await evaluate(()=>{
    check(firstReviewState.phase==='done'&&!firstGuideStep,'完成后刷新不重复触发');
    const round=firstReviewState.round;
    const fixture=grades=>{
      setReview('first',round.map((c,i)=>({...c,grade:grades[i]})),5);
      firstReviewSave({phase:'cards',choice:''});
      ui.mode='flash';renderFlash();
    };
    fixture([2,2,2,2,2]);
    check(firstGuideStep==='firstChoose'&&$('#firstReviewSpeak').disabled,'无难词时必须自己选一个');
    fixture([2,1,2,2,2]);
    check(firstGuideStep==='firstSpeak'&&!$('#firstReviewWord')&&!$('#firstReviewSpeak').disabled,'单个难词直接带入');
  });
  console.log('首次五词闭环通过：示例排除、5 个触发、刷新接续、三种推荐、AI 失败重试和反馈返回。');
}
