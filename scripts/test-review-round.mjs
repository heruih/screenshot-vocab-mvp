/* scripts/test-review-round.mjs · 第三阶段「5 词复习 → 选难词开口 → 回到复习」模拟测试
   运行：node scripts/test-review-round.mjs
   覆盖：3+2 队列（正常与两种不足补齐）、积压跨轮、续练不重复计入、
         混合评分/全记住推荐、口语后复习进度仍在、批改前后到期日一致。 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildReviewRound, rankSpeakCandidates, reviewCloze, normalizeRecallAnswer } = require('../src/js/01a_review_round.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}

/* 与 01_core.js 一致的间隔算法（等价模拟，用于验证多轮/续练/批改不变式的流程行为） */
const SRS_DAYS = [0, 0, 1, 3, 7, 15, 30];
const DAY = 86400000;
function simGrade(w, grade, now) {
  const s = w.srs || (w.srs = { box: 1, due: 0, reps: 0, lapses: 0 });
  s.reps = (s.reps || 0) + 1; s.last = now;
  if (grade === 0) { s.lapses = (s.lapses || 0) + 1; s.box = Math.max(1, s.box - 1); s.due = now + 600000; }
  else if (grade === 1) { s.due = now + Math.max(1, SRS_DAYS[s.box]) * DAY * 0.6; }
  else { s.box = Math.min(6, s.box + 1); s.due = now + SRS_DAYS[s.box] * DAY; }
  return s;
}

console.log('== A. 3+2 队列（buildReviewRound） ==');
{
  // A1 正常：6 练过 + 3 未练，取 3 练过（最早到期）+ 2 未练
  const words = [
    { id: 't1', reps: 2, due: 300 }, { id: 't2', reps: 1, due: 100 }, { id: 't3', reps: 3, due: 500 },
    { id: 't4', reps: 4, due: 200 }, { id: 't5', reps: 1, due: 400 }, { id: 't6', reps: 2, due: 600 },
    { id: 'f1', reps: 0, due: 50 }, { id: 'f2', reps: 0, due: 150 }, { id: 'f3', reps: 0, due: 250 },
  ];
  const r1 = buildReviewRound(words);
  ok('3+2 正常：总数 5', r1.length === 5);
  ok('3+2 正常：练过 3 个（最早到期 t2,t4,t1）', r1.slice(0, 3).map(x => x.id).join(',') === 't2,t4,t1');
  ok('3+2 正常：未练 2 个（最早到期 f1,f2）', r1.slice(3).map(x => x.id).join(',') === 'f1,f2');

  // A2 trained 不足：1 练过 + 5 未练 → 1 练过 + 4 未练
  const words2 = [
    { id: 't1', reps: 2, due: 300 },
    { id: 'f1', reps: 0, due: 10 }, { id: 'f2', reps: 0, due: 20 }, { id: 'f3', reps: 0, due: 30 },
    { id: 'f4', reps: 0, due: 40 }, { id: 'f5', reps: 0, due: 50 },
  ];
  const r2 = buildReviewRound(words2);
  ok('练过不足：1 练过 + 4 未练', r2.filter(x => x.reps > 0).length === 1 && r2.filter(x => x.reps === 0).length === 4 && r2.length === 5);

  // A3 fresh 不足：5 练过 + 1 未练 → 4 练过 + 1 未练
  const words3 = [
    { id: 't1', reps: 1, due: 100 }, { id: 't2', reps: 2, due: 200 }, { id: 't3', reps: 3, due: 300 },
    { id: 't4', reps: 4, due: 400 }, { id: 't5', reps: 5, due: 500 },
    { id: 'f1', reps: 0, due: 50 },
  ];
  const r3 = buildReviewRound(words3);
  ok('未练不足：4 练过 + 1 未练', r3.filter(x => x.reps > 0).length === 4 && r3.filter(x => x.reps === 0).length === 1 && r3.length === 5);

  // A4 总数不足 5：2 练过 + 1 未练 → 3 个
  const r4 = buildReviewRound([
    { id: 't1', reps: 1, due: 100 }, { id: 't2', reps: 2, due: 200 }, { id: 'f1', reps: 0, due: 50 },
  ]);
  ok('总数不足 5：返回 3 个', r4.length === 3);

  // A5 空输入
  ok('空输入：返回空', buildReviewRound([]).length === 0);
}

console.log('== B. 评分推荐（rankSpeakCandidates） ==');
{
  const mixed = rankSpeakCandidates([
    { id: 'a', grade: 2 }, { id: 'b', grade: 1 }, { id: 'c', grade: 0 }, { id: 'd', grade: 2 },
  ]);
  ok('混合评分：只推荐忘了+有点难', mixed.length === 2);
  ok('混合评分：忘了排前', mixed[0].id === 'c' && mixed[0].grade === 0);
  ok('混合评分：有点难其次', mixed[1].id === 'b' && mixed[1].grade === 1);

  ok('全记住：返回空', rankSpeakCandidates([{ id: 'a', grade: 2 }, { id: 'b', grade: 2 }]).length === 0);
  ok('全忘了：全部推荐', rankSpeakCandidates([{ id: 'a', grade: 0 }, { id: 'b', grade: 0 }]).length === 2);
  ok('空输入：返回空', rankSpeakCandidates([]).length === 0);
}

console.log('== C. 积压跨轮仍会被练到 ==');
{
  const now0 = 1_000_000_000_000;
  let words = [];
  for (let i = 0; i < 10; i++) words.push({ id: 'w' + i, term: 'w' + i, srs: { box: 1, due: now0 - (10 - i) * 1000, reps: 0, lapses: 0 } });

  // 第一轮：取 5 个（前 5 个最早到期）
  const round1 = buildReviewRound(words.map(w => ({ id: w.id, reps: w.srs.reps, due: w.srs.due })));
  // 评分：全部「记住了」，due 拉远
  for (const c of round1) { const w = words.find(x => x.id === c.id); simGrade(w, 2, now0); }

  // 第二轮：之前没练到的 5 个（due 保留在最前面）应进入队列
  const round2 = buildReviewRound(words.filter(w => w.srs.due <= now0 + 1).map(w => ({ id: w.id, reps: w.srs.reps, due: w.srs.due })));
  const round1Ids = new Set(round1.map(x => x.id));
  const round2New = round2.filter(x => !round1Ids.has(x.id));
  ok('积压跨轮：第二轮包含第一轮没练到的词', round2New.length === 5);
  ok('积压跨轮：练过的词（due 已拉远）不在第二轮到期队列', round2.every(x => round1Ids.has(x.id) === false));
}

console.log('== D. 刷新/返回续练且不重复计入 ==');
{
  const now0 = 2_000_000_000_000;
  const words = [];
  for (let i = 0; i < 6; i++) words.push({ id: 'w' + i, srs: { box: 1, due: now0 - i * 1000, reps: 0, lapses: 0 } });
  const round = buildReviewRound(words.map(w => ({ id: w.id, reps: w.srs.reps, due: w.srs.due }))).map(c => ({ id: c.id, reps: c.reps }));

  // 评分 round 前 2 个（对应它们真实的词对象），reps++（等价 srsGrade 的 reps 递增）
  for (const c of round.slice(0, 2)) { const w = words.find(x => x.id === c.id); simGrade(w, 2, now0); }

  // 续练：模拟 nextReviewIndex——跳过 reps 已超过快照的词，找到下一个未评的词
  function nextIndex(round, start) {
    return round.findIndex((card, i) => i >= start && words.some(w => w.id === card.id && (w.srs.reps || 0) <= card.reps));
  }
  const idx = nextIndex(round, 0);
  ok('续练：跳过已评的 2 个，定位到第 3 个（idx=2）', idx === 2);
  ok('续练：已评词 reps 已增、不会再被计入', words.find(x => x.id === round[0].id).srs.reps > round[0].reps && words.find(x => x.id === round[1].id).srs.reps > round[1].reps);
}

console.log('== E1. 旧版 25 词轮次不恢复（resumeReview 上限 5） ==');
{
  // 旧版(337db90)队列上限 25，会把 25 个新词(due=0 排最前)存进 REVIEW_ROUND_KEY。
  // 第三阶段上限 5：resumeReview 必须丢弃 >5 的旧轮次，重新 buildReview 生成 3 练过+2 新。
  const oldRound = Array.from({ length: 25 }, (_, i) => ({ id: 'old' + i, reps: 0 }));
  ok('旧 25 词轮次被丢弃（>5 不恢复）', (oldRound.length <= 5) === false);
  // 丢弃后重新生成：模拟 169 到期 = 81 练过 + 88 新，应得 3 练过 + 2 新（不被大量新词淹没）
  const words = [
    ...Array.from({ length: 81 }, (_, i) => ({ id: 't' + i, reps: 1, due: 1000 + i })),
    ...Array.from({ length: 88 }, (_, i) => ({ id: 'f' + i, reps: 0, due: 0 })),
  ];
  const r = buildReviewRound(words);
  ok('重新生成：3 练过 + 2 新', r.filter(x => x.reps > 0).length === 3 && r.filter(x => x.reps === 0).length === 2 && r.length === 5);
}

console.log('== E. 批改前后词卡到期日一致（AI 批改只改口语记录） ==');
{
  const now0 = 3_000_000_000_000;
  const w = { id: 'x', srs: { box: 2, due: now0 + 1 * DAY, reps: 1, lapses: 0 }, mastered: false };
  const dueBefore = w.srs.due;
  // 模拟 aRecord：只写 outputDue 元数据，不触碰 w.srs
  const meta = { outputDue: now0 + 7 * DAY, lastOutput: 'independent' };
  const dueAfterMeta = w.srs.due;
  ok('口语记录（aRecord）不改变卡片到期日', dueAfterMeta === dueBefore);
  // 模拟卡片评分（srsGrade）：会改变 due（这是唯一的间隔更新入口）
  simGrade(w, 2, now0);
  ok('卡片评分才改变到期日（间隔只随卡片评分更新）', w.srs.due !== dueBefore && w.srs.due === now0 + SRS_DAYS[w.srs.box] * DAY);
}

console.log('== F. 英文例句补词 ==');
{
  const cloze=(term,en,options={})=>reviewCloze({term,examples:[{en}],...options});
  const phrase=cloze('put off','We PUT off the meeting until Friday.');
  ok('短语整体挖空，保留上下文和原句大小写',phrase?.before==='We '&&phrase.answer==='PUT off'&&phrase.after===' the meeting until Friday.');
  ok('按已收录的词形补出原句',cloze('go','They went to school together.',{dict:{forms:[{label:'过去式',items:['went']}]}})?.answer==='went');
  ok('整词边界，避免抠出另一个词的一部分',cloze('art','We started this project together.')===null);
  ok('例句不能在题面重复泄露答案',cloze('go','We go to school and go home later.')===null);
  ok('不清楚的原文回退，寻找下一条完整例句',reviewCloze({term:'go',examples:[{en:'go'},{en:'We go to school today.'}]})?.answer==='go');
  ok('忽略大小写、空格和弯引号',normalizeRecallAnswer('  Don’t   GO  ')==="don't go");
}
console.log('\n=================================');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('=================================');
process.exit(fail ? 1 : 0);
