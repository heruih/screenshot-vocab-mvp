/* ============ 学习身份（独立 key，不碰主数据，可随时切换/回滚） ============ */
const PERSONA_KEY='english-notes-persona-v1';
const PERSONA_SEEN_KEY='english-notes-persona-seen-v1';
const PERSONA_FREE='free';
const PERSONA_EXAM='exam';
let personaCache=null;
/* 弹窗是否已自动展示过：哪怕用户没点选项就切走，也保证只自动弹这一次 */
function personaWasSeen(){
  try{ return localStorage.getItem(PERSONA_SEEN_KEY)==='1'; }catch(_){ return false; }
}
function personaMarkSeen(){
  try{ aStore(PERSONA_SEEN_KEY,'1'); }catch(_){}
}
function personaReadRaw(){
  try{ return localStorage.getItem(PERSONA_KEY); }catch(_){ return null; }
}
/* 当前身份：'free' | 'exam'；从未选择返回 null */
function personaGet(){
  if(personaCache!==null)return personaCache;
  const v=personaReadRaw();
  personaCache=(v===PERSONA_EXAM)?PERSONA_EXAM:(v===PERSONA_FREE)?PERSONA_FREE:null;
  return personaCache;
}
function personaIsExam(){ return personaGet()===PERSONA_EXAM; }
function personaSet(v){
  const val=(v===PERSONA_EXAM)?PERSONA_EXAM:PERSONA_FREE;
  personaCache=val;
  try{ aStore(PERSONA_KEY,val); }catch(_){}
  personaSyncUI();
}
/* 全新用户：没有真实单词、没有真实笔记（demo 内容不算），用于决定是否自动弹身份卡 */
function personaIsFresh(){
  try{
    const words=(state.words||[]).filter(w=>w.source!=='demo');
    const notes=(state.notes||[]).filter(n=>n.id!=='n_welcome');
    return !words.length&&!notes.length;
  }catch(_){ return false; }
}
function openPersona(){ personaSyncUI(); $('#personaModal').classList.add('show'); }
function closePersona(){ $('#personaModal').classList.remove('show'); }
/* 首次启动：全新用户且没选过才自动弹，且只自动弹这一次；老用户升级不打扰，只在设置里可见 */
function personaMaybeShow(){
  try{
    if(personaGet()!==null)return;     /* 已明确选择，不再弹 */
    if(personaWasSeen())return;        /* 已自动弹过一次（即便没点选项），不再打扰 */
    if(!personaIsFresh())return;       /* 老用户不打扰 */
    personaMarkSeen();                 /* 先标记再弹，确保只自动弹这一次 */
    openPersona();
  }catch(_){}
}
/* 同步设置页摘要与选中态 */
function personaSyncUI(){
  const cur=personaGet()||PERSONA_FREE;
  const sum=$('#stgSumPersona');
  if(sum)sum.textContent=cur===PERSONA_EXAM?'我在备考':'自由学习';
  document.querySelectorAll('.persona-pick').forEach(btn=>{
    btn.classList.toggle('active',btn.getAttribute('data-persona-pick')===cur);
  });
}
function personaBind(){
  document.querySelectorAll('#personaModal .persona-opt').forEach(btn=>{
    btn.addEventListener('click',()=>{
      personaSet(btn.getAttribute('data-persona'));
      closePersona();
      try{ render(); }catch(_){}
    });
  });
  const skip=$('#personaSkip');
  if(skip)skip.addEventListener('click',()=>{
    personaSet(PERSONA_FREE);   /* 跳过按自由派处理，并记住不再弹 */
    closePersona();
    try{ render(); }catch(_){}
  });
  document.querySelectorAll('.persona-pick').forEach(btn=>{
    btn.addEventListener('click',()=>{
      personaSet(btn.getAttribute('data-persona-pick'));
      try{ render(); }catch(_){}
    });
  });
}
