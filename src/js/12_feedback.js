/* 商业版内测反馈。提交成功前保留用户输入，同一条原样重试沿用编号。 */
function initFeedback(){
  if(window.APP_CONFIG?.product!=='commercial')return;
  const entry=$('#moreFeedback'),modal=$('#feedbackModal'),form=$('#feedbackForm');
  const message=$('#feedbackMessage'),reply=$('#feedbackReply'),login=$('#feedbackLogin');
  const status=$('#feedbackStatus'),send=$('#feedbackSend');
  let pending=null,busy=false,expiredToken=null;

  function syncAccess(){
    login.hidden=accountLoggedIn()&&accountToken()!==expiredToken;
    send.disabled=busy||!login.hidden;
  }

  function close(){
    modal.classList.remove('show');
    modal.hidden=true;
    entry.focus();
  }

  entry.hidden=false;
  entry.addEventListener('click',()=>{
    syncAccess();
    modal.hidden=false;
    modal.classList.add('show');
    $('#feedbackClose').focus();
  });
  $('#feedbackClose').addEventListener('click',close);
  modal.addEventListener('click',event=>{if(event.target===modal)close();});
  modal.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&modal.classList.contains('show')){
      event.stopPropagation();
      close();
    }
  });
  $('#feedbackLoginBtn').addEventListener('click',()=>{
    close();
    openLogin();
  });

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const text=message.value.trim(),allowReply=reply.checked;
    if(busy||!login.hidden)return;
    if(!text){status.textContent='先写下你的反馈，再提交。';return;}
    if(pending?.message!==text||pending?.allowReply!==allowReply||pending?.email!==accountEmail()){
      const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
      pending={requestId,message:text,allowReply,email:accountEmail()};
    }

    busy=true;
    syncAccess();
    status.textContent='正在提交…';
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
    try{
      const {requestId}=pending;
      const token=accountToken();
      const result=await fetch(accountBase()+'/v1/feedback',{
        method:'POST',headers:{'Content-Type':'application/json',...accountAuthHeader()},
        body:JSON.stringify({requestId,message:text,allowReply}),signal:ctrl.signal
      });
      const data=await result.json().catch(()=>null);
      if(!result.ok||!data?.ok){
        if(result.status===401&&token===accountToken()){
          expiredToken=token;
          accountRefresh();
        }
        status.textContent=data?.message||'提交失败，已保留原文，请稍后重试。';
        return;
      }
      pending=null;
      if(message.value.trim()===text&&reply.checked===allowReply)form.reset();
      status.textContent='反馈已收到，感谢你告诉我们。';
    }catch(_){
      status.textContent='暂时连不上，已保留原文，可以直接重试。';
    }finally{
      clearTimeout(timer);
      busy=false;
      syncAccess();
    }
  });
}
