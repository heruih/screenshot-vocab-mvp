// 分析脚本：人工 ground truth 对照 OCR 结果，算召回/精确率/内容词召回/CER
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(fs.readFileSync(path.join(__dir, 'results', 'raw.json'), 'utf8'));

// 人工逐张核对的英文字幕 ground truth
const GT = [
  'China has prospered immensely.',
  "I mean I've seen it firsthand like you",
  'also having us here at Tesla Global Engineer Headquarters.',
  "I mean, I've seen it firsthand.",
  'If you visit China and you see the amount of progress that happens from',
  "one year to the next or even within a year, it's very visible.",
  'You can see the new buildings, the new infrastructure.',
  'Chinese citizen has increased tremendously.',
  'China just has a very strong inherent ability to do manufacturing well.',
  'I think that, to be totally frank, the',
  'So the Tesla Shanghai factory is a gem.',
  "It's beautiful, actually, if anyone's ever been there.",
  'I mean, it\'s pretty cool because we designed the car to look futuristic.',
  "Because I think from a fashion standpoint, we don't",
  'want the aesthetics of the street to stay stagnant.',
  'Well we have the cyber cab which has as you',
  'know has no steering wheel or pedals or side mirrors',
  'or rear view mirror operating commercially in Texas right now',
  'I mean the rate of AI software improvements and major announcements is so rapid',
  "that it makes my head spin, you know,",
];

// 内容词判断用的功能词集合（取自产品 ocrStopWords，用于评估实词召回）
const STOP = new Set(['the','and','for','with','that','this','from','have','has','had','you','your','are','was','were','not','but','what','when','where','who','why','how','all','can','will','just','like','about','into','out','over','again','then','than','them','they','their','there','here','because','very','really','much','more','most','some','any','get','got','going','go','goes','been','being','would','could','should','shall','may','might','must','do','does','did','done','is','it','its','i','he','she','we','on','in','at','to','of','a','an','so','if','or','as','up','down','off','no','yes','ok','okay','oh','yeah','know','knows','say','says','said','see','saw','seen','look','looks','think','thinks','thought','want','wants','need','needs','make','makes','made','take','takes','took','come','comes','came','right','good','bad','day','days','time','times','thing','things','one','two','three','new','now','us','im','ive','ill','dont','cant','didnt','wont','isnt','wasnt','werent','arent','youre','hes','shes','theyre','whats','thats','guys','guy','girl','boy','people','person','man','woman','men','women','kids','child','children','home','house','work','works','way','ways','lot','lots','little','big','long','short','well','actually','pretty','quite']);

function tokens(s) {
  return String(s).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
}
// multiset 计数
function bag(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}
function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function scoreAgainst(gtText, hypText) {
  const gt = tokens(gtText), hyp = tokens(hypText);
  const gBag = bag(gt), hBag = bag(hyp);
  let hits = 0;
  for (const [k, v] of gBag) hits += Math.min(v, hBag.get(k) || 0);
  const gtSet = new Set(gt), hypSet = new Set(hyp);
  let truePos = 0;
  for (const k of hBag) if (gtSet.has(k[0])) truePos += Math.min(k[1], gBag.get(k[0]) || 0);
  // 内容词召回
  const contentGt = gt.filter(w => !STOP.has(w));
  const contentHits = contentGt.reduce((s, w) => s + (hBag.get(w) ? 1 : 0), 0);
  // 去重后的目标词召回（unique，回答“这个表达里的词有没有被抓到”）
  const uniqGt = [...gtSet];
  const uniqHits = uniqGt.filter(w => hypSet.has(w)).length;
  const cer = gt.length ? levenshtein(gt.join(' '), hyp.join(' ')) / gt.join(' ').length : null;
  return {
    gtN: gt.length, hypN: hyp.length,
    recall: hits / gt.length,
    precision: hyp.length ? truePos / hyp.length : 0,
    uniqRecall: uniqGt.length ? uniqHits / uniqGt.length : 0,
    contentRecall: contentGt.length ? contentHits / contentGt.length : 1,
    contentN: contentGt.length,
    cer,
    missed: uniqGt.filter(w => !hypSet.has(w)),
    noise: [...hypSet].filter(w => !gtSet.has(w)),
  };
}

const detail = [];
for (let i = 0; i < GT.length; i++) {
  const r = raw.rows[i];
  const a = scoreAgainst(GT[i], r.pathA.text);
  const b = scoreAgainst(GT[i], r.pathB.text);
  const bk = scoreAgainst(GT[i], (r.pathB.wordsKept || []).join(' '));
  detail.push({ file: r.file, gt: GT[i], pathA: a, pathB: b, pathBWordsKept: bk,
    msA: r.pathA.ms, msB: r.pathB.ms, confA: r.pathA.confidence, confB: r.pathB.confidence });
}
function avg(k, sub) {
  const vals = detail.map(d => d[sub][k]).filter(x => x !== null && !Number.isNaN(x));
  return vals.reduce((s, x) => s + x, 0) / vals.length;
}
const summary = {
  pathA: {
    recall: avg('recall', 'pathA'), precision: avg('precision', 'pathA'),
    uniqRecall: avg('uniqRecall', 'pathA'), contentRecall: avg('contentRecall', 'pathA'),
    cer: avg('cer', 'pathA'), avgMs: detail.reduce((s, d) => s + d.msA, 0) / detail.length,
    avgConf: detail.reduce((s, d) => s + d.confA, 0) / detail.length,
  },
  pathB: {
    recall: avg('recall', 'pathB'), precision: avg('precision', 'pathB'),
    uniqRecall: avg('uniqRecall', 'pathB'), contentRecall: avg('contentRecall', 'pathB'),
    cer: avg('cer', 'pathB'), avgMs: detail.reduce((s, d) => s + d.msB, 0) / detail.length,
    avgConf: detail.reduce((s, d) => s + d.confB, 0) / detail.length,
  },
  pathBWordsKept: {
    recall: avg('recall', 'pathBWordsKept'), precision: avg('precision', 'pathBWordsKept'),
    contentRecall: avg('contentRecall', 'pathBWordsKept'),
  },
  coldStartMs: raw.meta.coldStart.highLevelRecognizeMs,
};
const pct = x => (x * 100).toFixed(1) + '%';
console.log('=== 汇总（20张）===');
for (const name of ['pathA', 'pathB', 'pathBWordsKept']) {
  const s = summary[name];
  console.log(`\n[${name}] 召回${pct(s.recall)} 去重召回${pct(s.uniqRecall ?? s.recall)} 内容词召回${pct(s.contentRecall)} 精确率${pct(s.precision)}` +
    (s.cer !== undefined ? ` CER${pct(s.cer)}` : '') + (s.avgMs !== undefined ? ` 平均${s.avgMs.toFixed(0)}ms` : ''));
}
console.log(`\n冷启动(高层端到端): ${summary.coldStartMs}ms`);
console.log('\n=== 每张明细（去重召回 / 精确率 / 内容词召回）===');
for (const d of detail)
  console.log(`${d.file} A: ${pct(d.pathA.uniqRecall)}/${pct(d.pathA.precision)}/${pct(d.pathA.contentRecall)}  B: ${pct(d.pathB.uniqRecall)}/${pct(d.pathB.precision)}/${pct(d.pathB.contentRecall)}  漏:${(d.pathB.missed.join(',') || '无')}`);

fs.writeFileSync(path.join(__dir, 'results', 'metrics.json'), JSON.stringify({ summary, detail }, null, 2));
console.log('\n指标已写 results/metrics.json');
