/* ============ 错因标签（独立 key，按词 id 映射，不碰主数据，可随时回滚） ============ */
const ERRORCAUSE_KEY='english-notes-errorcause-v1';
/* 三类错因：没看懂 / 没听清 / 难搭配 */
const ERROR_CAUSES=[
  {id:'meaning',label:'没看懂'},
  {id:'listening',label:'没听清'},
  {id:'collocation',label:'难搭配'}
];
let errorCauseCache=null;
function errorCauseMap(){
  if(errorCauseCache)return errorCauseCache;
  const m=aRead(ERRORCAUSE_KEY,{});
  errorCauseCache=(m&&typeof m==='object')?m:{};
  return errorCauseCache;
}
/* 某个词已记录的错因 id 数组（没有则空数组） */
function errorCauseGet(wordId){
  const rec=errorCauseMap()[wordId];
  const arr=rec&&Array.isArray(rec.c)?rec.c:[];
  return arr.filter(c=>ERROR_CAUSES.some(x=>x.id===c));
}
function errorCauseLabel(cause){
  const f=ERROR_CAUSES.find(x=>x.id===cause);
  return f?f.label:cause;
}
function errorCauseSave(wordId,causes){
  const m=errorCauseMap();
  const uniq=causes.filter((c,i)=>causes.indexOf(c)===i&&ERROR_CAUSES.some(x=>x.id===c));
  if(!uniq.length)delete m[wordId];
  else m[wordId]={c:uniq,t:Date.now()};
  errorCauseCache=m;
  return aStore(ERRORCAUSE_KEY,JSON.stringify(m));
}
/* 点一下选中、再点取消；返回切换后的数组 */
function errorCauseToggle(wordId,cause){
  const cur=errorCauseGet(wordId);
  const i=cur.indexOf(cause);
  if(i>=0)cur.splice(i,1); else cur.push(cause);
  errorCauseSave(wordId,cur);
  return cur;
}
