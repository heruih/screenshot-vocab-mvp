export async function testFirstOwn({loadPage,evaluate,cdp}){
  if(process.argv.includes('--mobile')){
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await cdp('Emulation.setTouchEmulationEnabled',{enabled:true});
  }
  const waitFor=async(test)=>{
    for(let i=0;i<100;i++){
      if(await evaluate(test))return;
      await new Promise(resolve=>setTimeout(resolve,35));
    }
    throw new Error('等待真实截图引导超时 '+test.toString());
  };
  await loadPage();
  await evaluate(async()=>{
    if($('#personaModal').classList.contains('show'))click('#personaSkip');
    check(!accountLoggedIn()&&$('#firstOwnStart')&&!firstGuideStep,'首页可直接选自己的截图');
    const canvas=document.createElement('canvas');
    canvas.width=640;canvas.height=240;
    canvas.getContext('2d').fillText('We put off the meeting until Friday.',40,110);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    const list=new DataTransfer();
    list.items.add(new File([blob],'my-meeting.png',{type:'image/png'}));
    const field=$('#firstOwnFile');
    field.files=list.files;
    field.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await waitFor(()=>firstGuideStep==='ownNote');
  await evaluate(()=>{
    $('#ocrNewNoteName').value='我的会议笔记';
    $('#ocrNewNoteName').dispatchEvent(new Event('input',{bubbles:true}));
    check(firstGuideStep==='ownCreate','填写名称后指向新建');
    click('#ocrNoteNewBtn');
  });
  await waitFor(()=>firstGuideStep==='ownPreview');
  await evaluate(()=>{
    loadOcrEngine=async()=>{};
    recognizeOcrPhoto=async()=> 'We put off the meeting until Friday.';
    click('#ocrImgWrap [data-ocr-frame]');
    check(firstGuideStep==='ownFrame','真实截图中提示框选');
  });
  await waitFor(()=>!!ocrImageView?.scale);
  const points=await evaluate(()=>{
    const r=$('#ocrViewerImage').getBoundingClientRect();
    return [{x:r.x+r.width*.08,y:r.y+r.height*.16},{x:r.x+r.width*.92,y:r.y+r.height*.8}];
  });
  const [start,end]=points;
  if(process.argv.includes('--mobile')){
    await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
    await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[end]});
    await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }else{
    await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
    await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...end,button:'left',buttons:1});
    await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1});
  }
  await waitFor(()=>firstGuideStep==='ownApply');
  await evaluate(()=>click('#ocrRegionApply'));
  await waitFor(()=>firstGuideStep==='ownWord');
  await evaluate(()=>{
    click('[data-ocr-token="3"]');click('[data-ocr-token="7"]');
    click('[data-ocr-add-selected]');
    check(firstGuideStep==='ownSave','可选用户自己的短语');
    click('#ocrMount');
  });
  await waitFor(()=>$('#firstOwnModal').classList.contains('show'));
  await evaluate(()=>{
    check($('#firstOwnTerm').textContent==='put off','从自己的截图接着造句');
    const word=state.words.find(w=>w.term==='put off');
    check(word.notes.length===1&&state.notes[0].content.includes('We put off'),'自己的词和原句已进入笔记');
    const field=$('#firstOwnAnswer');
    field.value='We can put off the trip until Saturday.';
    field.dispatchEvent(new Event('input',{bubbles:true}));
    click('#firstOwnSubmit');
    check($('#accountLoginModal').classList.contains('show'),'点点评时才要求登录');
    check(firstOwnDraft.attempt===field.value,'登录前已保存句子');
    window.firstOwnId=firstOwnDraft.requestId;
    click('#almClose');
    check($('#firstOwnModal').classList.contains('show'),'可关登录回草稿');
  });
  await loadPage();
  await evaluate(()=>{
    click('#firstOwnStart');
    check($('#firstOwnAnswer').value==='We can put off the trip until Saturday.','刷新后可继续原来的句子');
    accountApi=async(path)=>{
      if(path==='/v1/auth/request-code')return {status:200,data:{ok:true}};
      if(path==='/v1/auth/verify')return {status:200,data:{token:'isolated-test-session'}};
      return {status:503,data:{message:'隔离测试账号状态'}};
    };
    window.requests=[];
    dialogueReviewFetch=async(answers,id)=>{
      check(accountLoggedIn(),'已验证邮箱才发送批改');
      window.requests.push({answers,id});
      if(window.requests.length===1)throw new Error('模拟批改失败');
      return [{standard:'We can put off the trip until Saturday.',fit:'用法自然',pitfalls:[]}];
    };
    click('#firstOwnSubmit');
    $('#almEmail').value='learner@example.invalid';click('#almSendCode');
  });
  await waitFor(()=>!$('#almCodeStep').hidden);
  await evaluate(()=>{
    $('#almCode').value='246802';click('#almDoVerify');
  });
  await waitFor(()=>$('#firstOwnMessage').textContent==='模拟批改失败');
  await evaluate(()=>{
    check(requests.length===1&&requests[0].answers[0].attempt==='We can put off the trip until Saturday.','邮箱验证后直接发送原句子');
    click('#firstOwnSubmit');
  });
  await waitFor(()=>!$('#firstOwnFeedback').hidden);
  await evaluate(()=>{
    check(requests[0].id===requests[1].id,'同一句重试复用原批改编号');
    check($('#firstOwnFit').textContent==='用法自然','展示真实接口结构的点评');
    click('#firstOwnAgain');
    check($('#firstOwnAnswer').value===''&&$('#firstOwnFeedback').hidden,'还可以用同一表达继续练');
    click('#firstOwnClose');
  });
  console.log('真实截图→归入笔记→写一句→登录→同句批改通过，覆盖中途刷新和失败重试。');
}
