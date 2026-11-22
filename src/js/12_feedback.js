/* ============ 12_feedback.js · 意见反馈（金数据表单，零后端） ============
   用法：在金数据建一个含「多行文字 + 图片（可选）」字段的表单，
   把表单链接里的 token 填到下方 FEEDBACK_FORM_TOKEN，重新构建即可。
   表单通过 iframe 嵌入，提交与图片上传由金数据处理，不暴露任何密钥。 */
const FEEDBACK_FORM_TOKEN='';
function feedbackFormUrl(){
  const tok=String(FEEDBACK_FORM_TOKEN||'').trim();
  if(!tok)return '';
  return 'https://jinshuju.net/f/'+tok+
    '?background=transparent&banner=hide&embedded=true&inner_redirect=true';
}
let feedbackLoaded=false;
function openFeedback(){
  const modal=$('#feedbackModal'),frame=$('#feedbackFrame'),empty=$('#feedbackEmpty');
  const url=feedbackFormUrl();
  if(!url){
    /* 表单还没配置：显示准备中，不加载 iframe */
    frame.hidden=true;empty.hidden=false;
  }else{
    empty.hidden=true;frame.hidden=false;
    /* 懒加载：第一次打开才设 src，不拖慢首屏 */
    if(!feedbackLoaded){ frame.src=url; feedbackLoaded=true; }
  }
  modal.classList.add('show');
}
function closeFeedback(){
  $('#feedbackModal').classList.remove('show');
}
function initFeedback(){
  /* 反馈入口已移到设置页底部 */
  const btn=$('#stFeedbackBtn');
  if(btn)btn.addEventListener('click',openFeedback);
  const close=$('#feedbackClose');
  if(close)close.addEventListener('click',closeFeedback);
  const modal=$('#feedbackModal');
  /* 点遮罩关闭（点卡片本身不关闭） */
  modal.addEventListener('click',e=>{ if(e.target===modal)closeFeedback(); });
}
