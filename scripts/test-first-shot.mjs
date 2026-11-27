
export async function testFirstShot({loadPage,evaluate,cdp}){
  if(!process.argv.includes('--desktop')){
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await cdp('Emulation.setTouchEmulationEnabled',{enabled:true});
  }
  await loadPage();
  await evaluate(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const pending=firstShotExample();
    for(let i=0;i<50&&!$('#ocrFolderStart').onclick;i++)await wait(20);
    $('#ocrNewNoteName').value='First note';
    click('#ocrNoteNewBtn');click('#ocrFolderStart');await pending;
    click('[data-ocr-token="3"]');click('[data-ocr-token="7"]');click('[data-ocr-add-selected]');
    await ocrMount();
    check(ui.mode==='edit'&&firstShotState().term==='put off','应定位到笔记原句里的短语');
    check(bodyEl.textContent.includes('We put off the meeting'),'原句入笔记');
    check(!state.words.some(w=>w.term==='put off'),'首次亲手 Empower 前不自动进入词库');
  });
  await loadPage();
  await evaluate(async()=>{
    ui.mode='today';render();
    click('#firstShotResume');click('#edEmpower');click('#btnEmpower');
    check(wmState.firstShot,'刷新后恢复实际 Empower 教学');
    click('#wmSave');
    check(!firstShotState().done&&$('#wordModal').classList.contains('show'),'尚未标亮时仍在教学');
    const target=Array.from(document.querySelectorAll('#wmExamples .qw')).find(x=>x.textContent==='put');
    check(target,'原文应能逐词操作');target.click();
    click('#qdPhNext');click('#qdMark');
    check(firstShotState().marked==='We put off the meeting until Friday.','标亮目标短语');
    click('#wmSave');
    check(firstShotState().done,'标亮且保存后完成');
    const word=state.words.find(w=>w.term==='put off');
    check(word.notes.some(n=>n.noteId===ui.note)&&!aPending(word),'词卡关联来源且可学习');
    const image=shotsAll()[shotsKeyOf('put off')][0].dataUrl;
    const result=await importShotToNote(ui.note,['put off','meeting'],image,()=>firstShotState().line);
    showImportedNote(result);
    check(state.words.filter(w=>w.term==='put off').length===1,'重复导入不增加同名词卡');
    check(bodyEl.querySelectorAll('[data-shot-line]').length===1,'重复导入不增加相同原句');
    check(!aPending(state.words.find(w=>w.term==='meeting')),'批量确认直接加入学习');
    check(shotsAll()[shotsKeyOf('put off')].length===1,'相同截图只保存一次');
  });
  await loadPage();
  await evaluate(()=>{
    const word=state.words.find(w=>w.term==='put off');
    check(firstShotState().done&&word.notes.length===1,'完成状态与来源刷新后保留');
    check(qmMarks(word.term,0,firstShotState().line).some(m=>m.k.toLowerCase()==='put off'),'例句标亮刷新后保留');
  });
  console.log('首次截图、笔记、短语 Empower、标亮、批量及刷新续接通过。');
}
