export async function testFirstShot({loadPage,evaluate,cdp}){
  const desktop=process.argv.includes('--desktop');
  if(!desktop){
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await cdp('Emulation.setTouchEmulationEnabled',{enabled:true});
  }
  const waitFor=async(test)=>{
    for(let i=0;i<70;i++){
      if(await evaluate(test))return;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    throw new Error('等待引导界面超时 '+test.toString());
  };
  const draw=async(full)=>{
    const points=await evaluate(()=>{
      const r=$('#ocrViewerImage').getBoundingClientRect();
      return {x:r.x,y:r.y,w:r.width,h:r.height};
    });
    const from={x:points.x+points.w*0.08,y:points.y+points.h*0.36};
    const to={x:points.x+points.w*(full?0.90:0.28),y:points.y+points.h*0.65};
    if(desktop){
      await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
      await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...to,button:'left',buttons:1});
      await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',clickCount:1});
    }else{
      await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
      await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[to]});
      await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
  };

  await loadPage();
  await evaluate(()=>{
    if($('#personaModal').classList.contains('show'))click('#personaSkip');
    check(firstGuideStep==='sample','新用户完成身份选择后直接开始示例截图硬引导');
    click('#firstShotExample');
  });
  await waitFor(()=>firstGuideStep==='newNote'&&$('.first-guide-caption').textContent.includes('起个名字'));
  await evaluate(()=>{
    const field=$('#ocrNewNoteName').getBoundingClientRect();
    const opening=$('.first-guide-opening').getBoundingClientRect();
    const button=$('#ocrNoteNewBtn').getBoundingClientRect();
    check(opening.left<=field.left&&opening.right>=field.right&&opening.right<button.right,'输入亮区没有照亮相邻按钮');
    check(document.elementFromPoint(field.x+field.width/2,field.y+field.height/2)===$('#ocrNewNoteName'),'遮罩不吃原生输入事件');
  });
  await evaluate(()=>{
    click('#ocrFolderStart');
    check(firstGuideStep==='newNote'&&!state.notes.length,'必须亲手新建笔记');
    click('#ocrNoteNewBtn');
    check(firstGuideStep==='newNote','先填标题，不能直接新建');
    $('#ocrNewNoteName').value='练习笔记';
    $('#ocrNewNoteName').dispatchEvent(new Event('input',{bubbles:true}));
    check(firstGuideStep==='noteCreate','填写标题后箭头移到新建');
  });
  await waitFor(()=>$('.first-guide-caption').textContent.includes('继续导入'));
  await evaluate(()=>{
    const field=$('#ocrNewNoteName').getBoundingClientRect();
    const opening=$('.first-guide-opening').getBoundingClientRect();
    check(opening.left>field.left,'填完标题后遮罩只照亮新建按钮');
    click('#ocrNoteNewBtn');
  });
  await waitFor(()=>firstGuideStep==='preview');

  await loadPage();
  await waitFor(()=>firstGuideStep==='preview');
  await evaluate(()=>{
    check(state.notes.length===1,'刷新后复用已建练习笔记');
    click('#ocrImgWrap [data-ocr-whole]');
    check(firstGuideStep==='preview','整图识别无法绕过框选');
    click('#ocrImgWrap [data-ocr-frame]');
  });
  await waitFor(()=>!!ocrImageView?.scale&&firstGuideSpotlight.parentNode===$('#ocrImageViewer'));
  await evaluate(()=>{
    const r=$('#ocrImageViewport').getBoundingClientRect();
    check(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).closest('#ocrImageViewport'),'截图亮区能直接拖动');
  });
  await draw(false);
  await evaluate(()=>{
    click('#ocrRegionApply');
    check(firstGuideStep==='frame'&&$('#ocrImageViewer').open,'漏框文字时留在当前步骤');
  });
  await draw(true);
  await evaluate(()=>{
    check(firstGuideStep==='frameApply','框完整行才指向识别按钮');
    click('#ocrRegionApply');
    check(firstGuideStep==='word','有效框选后解锁选词');
    click('[data-ocr-token="0"]');
    check(firstGuideStep==='word','必须点目标词');
    click('[data-ocr-token="3"]');
    click('[data-ocr-add-selected]');
    check(firstGuideStep==='shotSave','点选后才可以保存截图');
  });
  await loadPage();
  await waitFor(()=>firstGuideStep==='shotSave');
  await evaluate(()=>click('#ocrMount'));
  await waitFor(()=>firstGuide.shot==='done'&&$('#wordModal').classList.contains('show'));
  await evaluate(()=>{
    const word=state.words.find(w=>w.term==='notice');
    const note=state.notes.find(n=>n.id===firstGuide.shotNoteId);
    check(ui.mode!=='edit'&&wmState.term==='notice','保存截图直接弹出单词卡');
    const body=document.createElement('div');body.innerHTML=note.content;
    check(word.notes.some(n=>n.noteId===note.id)&&body.textContent==='notice','练习笔记正文只写入目标词');
    check(word.examples.some(ex=>ex.en==='We notice small changes.'),'词卡保留截图原句');
    check(shotsAll()[shotsKeyOf('notice')].length===1,'练习截图已挂到目标词');
    click('#wmClose');
    check($('#wordModal').classList.contains('show')&&!firstGuide.note,'保存后留在词卡，笔记引导等待用户自行进入');
  });
  await loadPage();
  await waitFor(()=>firstGuideStep==='sampleCard');
  await evaluate(()=>{
    window.beforeExampleSrs=srsSnapshot();
    click('#firstShotFlash');
    check(firstGuideStep==='firstFlip'&&ui.flash.ids.length===1&&$('.flash-term').textContent==='notice','闪卡只练刚收录的词');
    check(!$('#firstShotSpeak'),'翻卡前未解锁 AI 对话');
    click('#flashCard');
    check(firstGuideStep==='sampleRate'&&$('.fb-def').textContent.includes('注意到'),'翻卡看含义再评分');
    click('[data-grade="2"]');
    check(firstGuideStep==='sampleSpeak'&&srsSnapshot()===beforeExampleSrs,'示例评分不改变正式复习进度');
    click('#firstShotSpeak');
    check($('#accountLoginModal').classList.contains('show'),'实际选择 AI 对话时才打开邮箱验证');
    click('#almClose');
    check(firstGuideStep==='sampleSpeak','取消登录回到可选的对话入口');
  });
  await loadPage();
  await waitFor(()=>firstGuideStep==='sampleSpeak');
  await evaluate(()=>{
    accountApi=async(path)=>{
      if(path==='/v1/auth/request-code')return {status:200,data:{ok:true}};
      if(path==='/v1/auth/verify')return {status:200,data:{token:'isolated-test-session'}};
      return {status:503,data:{message:'隔离测试账号状态'}};
    };
    dialogueReviewFetch=async(answers)=>{
      check(accountLoggedIn()&&answers[0].target==='notice','已验证邮箱并批改同一个目标词');
      return [{standard:'I noticed your bag by the door.',fit:'用法自然',pitfalls:[]}];
    };
    click('#firstShotSpeak');
    $('#almEmail').value='learner@example.invalid';click('#almSendCode');
  });
  await waitFor(()=>!$('#almCodeStep').hidden);
  await evaluate(()=>{$('#almCode').value='246802';click('#almDoVerify');});
  await waitFor(()=>$('#aiModal').classList.contains('show')&&aiState.lines.length===2);
  await evaluate(()=>{
    check(aiState.term==='notice'&&$('#aiScene').textContent.includes('找不到我的包'),'从闪卡接到同词新场景');
    click('#aiClose');
    check(firstGuideStep==='sampleSpeak','退出对话可回到练习选择');
    click('#firstShotSpeak');
    $('#aiInput').value='I noticed your bag by the door.';
    click('#aiSend');
  });
  await waitFor(()=>aiState.phase==='review');
  await evaluate(()=>{
    click('#aiClose2');
    check(firstShotPractice.phase==='done'&&!firstGuideStep&&ui.mode==='today','看完点评回首页并结束示例练习');
    firstShotOpenFlash('offer');
    click('#firstShotLater');
    check(firstShotPractice.phase==='done'&&!$('#aiModal').classList.contains('show'),'也可以直接跳过 AI 对话');
    const note=state.notes.find(n=>n.id===firstGuide.shotNoteId);
    click('[data-tab="list"]');
    check(firstGuideStep==='type'&&ui.note===note.id,'第一次主动点笔记才启动');
    bodyEl.focus();
  });
  await cdp('Input.insertText',{text:'empowerment'});
  await waitFor(()=>firstGuideStep==='select');
  await evaluate(()=>{
    check($('#edEmpower').textContent==='做词卡','使用中文按钮');
    click('#edEmpower');
    check(firstGuideStep==='select','必须先选中目标词才能打开做词卡');
    // CDP 测试用 Range 替代移动设备系统文本选区，真机仍需验长按。
    const walker=document.createTreeWalker(bodyEl,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())&&!node.data.includes('empowerment')){}
    const start=node.data.indexOf('empowerment'),range=document.createRange();
    range.setStart(node,start);range.setEnd(node,start+'empowerment'.length);
    getSelection().removeAllRanges();getSelection().addRange(range);checkSelection();
    click('#edEmpower');click('#btnEmpower');
    check(firstGuideStep==='mark'&&wmState.term==='empowerment','打开练习词卡');
    click('#wmClose');click('#wmSave');click('[data-wmtab="tags"]');
    check(firstGuideStep==='mark'&&$('#wordModal').classList.contains('show'),'关闭、保存和其他标签在当前步骤无效');
    click('#wmExamples [data-first-example-word]');
    check(firstGuideStep==='markApply','先点例句目标词，再指向标亮');
    click('#qdMark');
    check(firstGuideStep==='colls'&&firstGuideHasMark(wmState),'实际标亮完整目标词');
  });
  await waitFor(()=>!$('#qdSheet').classList.contains('show'));
  await evaluate(()=>{
    click('[data-wmtab="tags"]');
    check(firstGuideStep==='colls','不可跳过核心搭配');
    click('[data-wmtab="colls"]');
    check(firstGuideStep==='tags','点开核心搭配后解锁标签');
  });

  await loadPage();
  await waitFor(()=>firstGuideStep==='tags');
  await evaluate(()=>{
    check(firstGuideHasMark(wmState),'刷新后恢复标亮和当前步骤');
    click('[data-wmtab="tags"]');
    check(firstGuideStep==='save','点开标签后解锁保存');
    click('#wmSave');
    check(firstGuide.note==='done'&&!firstGuideStep&&ui.mode==='edit'&&!$('#wordModal').classList.contains('show'),'保存后直接回笔记并结束引导');
    check(state.words.filter(w=>w.term==='empowerment').length===1,'只建立一张练习词卡');
  });

  await loadPage();
  await evaluate(async()=>{
    check(firstGuide.note==='done'&&!firstGuideStep,'完成后刷新不再触发');
    const word=state.words.find(w=>w.term==='empowerment');
    check(firstGuideHasMark(word),'保存的例句标亮刷新后保留');
    click('[data-tab="list"]');
    check(ui.mode==='list','再次进入笔记走日常路径');
    const noteId=firstGuide.shotNoteId;
    const image=shotsAll()[shotsKeyOf('notice')][0].dataUrl;
    await importShotToNote(noteId,['notice','small'],image,()=>FIRST_SHOT_SENTENCE);
    check(state.words.filter(w=>w.term==='notice').length===1,'同名词卡不重复');
    check(shotsAll()[shotsKeyOf('notice')].length===1,'相同截图不重复');
    check(!aPending(state.words.find(w=>w.term==='small')),'普通批量收词仍可学习');
    const note=state.notes.find(n=>n.id===noteId);
    const body=document.createElement('div');body.innerHTML=note.content;
    check(Array.from(body.querySelectorAll('[data-shot-line]')).filter(line=>line.textContent===FIRST_SHOT_SENTENCE).length===1,
      '日常导入仍可写入原句，同一原句不重复写入');
  });
  await evaluate(async()=>{
    for(const tab of ['today','list','words','flash']){
      click('[data-tab="'+tab+'"]');
      await new Promise(resolve=>setTimeout(resolve,520));
      check(!$('.coach-bubble'),'商业版页面不弹介绍提示');
    }
    pwaPlatform=()=>({ios:true,android:false});
    check(showInstallPrompt()&&$('#pwaInstallGo'),'仍能提示添加到主屏幕');
    click('#pwaInstallDefer');
  });
  console.log('首次硬指引通过：新建后框选、只写入示例词、单词闪卡、邮箱续接 AI 对话、笔记引导及弹窗检查。');
}
