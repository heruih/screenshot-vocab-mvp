/* ===== 01a_review_round.js · 复习队列纯函数（无 DOM 依赖，可被 node 测试） ===== */
(function(){
  'use strict';
  /* 3+2 复习队列：优先 trained 个「练过的词」（按到期时间升序，最早到期在前）
     + fresh 个「从未练过的词」，某类不足就用另一类的合格词补齐，总数不超过 max。
     输入 words：已筛掉待整理、已到期、可练的词，形如 [{id, reps, due}]。 */
  function buildReviewRound(words, opts){
    opts=opts||{};
    var trainedN=(opts.trained!=null)?opts.trained:3;
    var freshN=(opts.fresh!=null)?opts.fresh:2;
    var max=(opts.max!=null)?opts.max:5;
    var byDue=function(a,b){ return (a.due||0)-(b.due||0); };
    var trained=words.filter(function(w){ return (w.reps||0)>0; }).sort(byDue);
    var fresh=words.filter(function(w){ return !((w.reps||0)>0); }).sort(byDue);
    var out=trained.slice(0,trainedN).concat(fresh.slice(0,freshN));
    if(out.length<max) out=out.concat(fresh.slice(freshN, freshN+(max-out.length)));
    if(out.length<max) out=out.concat(trained.slice(trainedN, trainedN+(max-out.length)));
    return out.slice(0,max);
  }
  /* 评分推荐口语词：只保留「忘了(0)」「有点难(1)」，忘了排前；记住了(2)不推荐。
     输入 results：[{id, grade}]，grade 0/1/2。输出按推荐优先级排序的 [{id, grade}]。 */
  function rankSpeakCandidates(results){
    return (results||[]).slice().filter(function(r){ return r.grade===0||r.grade===1; })
      .sort(function(a,b){ return a.grade-b.grade; });
  }
  function normalizeRecallAnswer(value){
    return String(value||'').trim().replace(/[‘’]/g,"'").replace(/\s+/g,' ').toLowerCase();
  }
  function reviewCloze(word){
    const term=normalizeRecallAnswer(word.term);
    if(!term) return null;
    const examples=Array.isArray(word.examples)?word.examples.filter(ex=>typeof ex?.en==='string'):[];
    const forms=Array.isArray(word.dict?.forms)?word.dict.forms:[];
    const inflections=forms.flatMap(form=>Array.isArray(form?.items)?form.items:[]).filter(item=>typeof item==='string').map(normalizeRecallAnswer);
    const targets=[...new Set([term,...inflections])].filter(value=>/^[a-z]+(?:[ '-][a-z]+)*$/.test(value));
    if(!targets.length) return null;
    const pattern=targets.sort((a,b)=>b.length-a.length)
      .map(value=>value.replace(/ /g,'\\s+')).join('|');
    const target=new RegExp("(^|[^a-z0-9_'’-])("+pattern+")(?![a-z0-9_'’-])",'gi');
    for(const example of examples){
      const sentence=example.en.trim();
      const hits=[...sentence.replace(/[‘’]/g,"'").matchAll(target)];
      if(hits.length!==1||sentence.length>240||!/^[\x20-\x7e\u00a0-\u024f\u2013-\u201d\s]+$/.test(sentence)) continue;
      const hit=hits[0], start=hit.index+hit[1].length;
      const before=sentence.slice(0,start), after=sentence.slice(start+hit[2].length);
      if(((before+' '+after).match(/[a-z]+/gi)||[]).length<3) continue;
      return {before,after,answer:sentence.slice(start,start+hit[2].length),hint:typeof example.cn==='string'?example.cn.trim():''};
    }
    return null;
  }
  var api={ buildReviewRound:buildReviewRound, rankSpeakCandidates:rankSpeakCandidates, reviewCloze:reviewCloze, normalizeRecallAnswer:normalizeRecallAnswer };
  if(typeof module==='object'&&module&&module.exports){ module.exports=api; }
  else if(typeof window!=='undefined'){ Object.assign(window,api); }
})();
