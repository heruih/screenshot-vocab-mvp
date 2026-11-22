/* ============ 抽象词 / 短语识别（本地查表，零 LLM 调用，独立 key 不碰主数据） ============
 * 数据：CONC_DATA 来自 Brysbaert 等(2014)人工具体度评分，分数已 ×100（100 最抽象 ~ 500 最具体）。
 * 规则：先整体查，再词形还原逐词查；未命中用词缀补判，仍判不出则默认“具体”（保守、省钱）。
 * 已知边界：本地评分给的是通用含义，识别不了领域引申 / 比喻（如篮球 wide open），这类靠手动换图 / 截图兜底。
 * ===================================================================================== */
const CONC_THRESHOLD = 300;                 // 量表中点(3.0)，低于此分判抽象；常见具体动作词均≥324不会误伤，可调
const ABSTRACT_SUFFIX = ['ness','ism','hood','tion','sion','ment','ity','ship','ance','ence','dom','sis'];

/* 轻量词形还原：返回包含原词在内的候选，命中任一即采用 */
function lemmaCandidates(w){
  const cands=[w];
  const doubledStem=(stem)=>{
    if(stem.length>=3 && stem[stem.length-1]===stem[stem.length-2] && 'aeiou'.includes(stem[stem.length-3])){
      cands.push(stem.slice(0,-1));        // running->runn->run；stopped->stopp->stop
    }
  };
  if(w.endsWith('ies')) cands.push(w.slice(0,-3)+'y');
  if(w.endsWith('ied')) cands.push(w.slice(0,-3)+'y');
  if(w.endsWith('es')){ cands.push(w.slice(0,-2)); cands.push(w.slice(0,-1)); }
  if(w.endsWith('s') && !w.endsWith('ss')) cands.push(w.slice(0,-1));
  if(w.endsWith('ing')){
    const stem=w.slice(0,-3);
    cands.push(stem); cands.push(stem+'e'); doubledStem(stem);   // making->make
  }
  if(w.endsWith('ed')){
    const stem=w.slice(0,-2);
    cands.push(stem); cands.push(stem+'e'); doubledStem(stem);
  }
  if(w.endsWith('ly')) cands.push(w.slice(0,-2));
  if(w.endsWith('er')) cands.push(w.slice(0,-2));
  if(w.endsWith('est')) cands.push(w.slice(0,-3));
  return cands;
}
function concScoreOfWord(w){
  if(Object.prototype.hasOwnProperty.call(CONC_DATA,w)) return CONC_DATA[w];
  for(const c of lemmaCandidates(w)){
    if(Object.prototype.hasOwnProperty.call(CONC_DATA,c)) return CONC_DATA[c];
  }
  return null;
}
function isAbstractTerm(term){
  const t=String(term||'').trim().toLowerCase();
  if(!t) return false;
  if(Object.prototype.hasOwnProperty.call(CONC_DATA,t)) return CONC_DATA[t] < CONC_THRESHOLD;

  const words=t.split(/\s+/);
  if(words.length===1){
    const s=concScoreOfWord(words[0]);
    if(s!==null) return s < CONC_THRESHOLD;
    return ABSTRACT_SUFFIX.some(suf=>words[0].endsWith(suf));   // 未命中：词缀补判，否则默认具体
  }
  let sawConcrete=false, allResolved=true;
  for(const w of words){
    const s=concScoreOfWord(w);
    if(s===null){ allResolved=false; continue; }
    if(s>=CONC_THRESHOLD) sawConcrete=true;
  }
  if(sawConcrete) return false;
  if(allResolved) return true;
  if(words.some(w=>ABSTRACT_SUFFIX.some(suf=>w.endsWith(suf)))) return true;
  return false;                                                // 多词仍判不出：默认具体
}
