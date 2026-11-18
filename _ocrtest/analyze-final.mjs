// 最终指标：v5 + 全部方案对比（同一套 ground truth 与口径）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const v5 = JSON.parse(fs.readFileSync(path.join(__dir, 'results', 'v5.json'), 'utf8'));
const old = JSON.parse(fs.readFileSync(path.join(__dir, 'results', 'metrics.json')), 'utf8');
const GT = [
  'China has prospered immensely.', "I mean I've seen it firsthand like you",
  'also having us here at Tesla Global Engineer Headquarters.', "I mean, I've seen it firsthand.",
  'If you visit China and you see the amount of progress that happens from',
  "one year to the next or even within a year, it's very visible.",
  'You can see the new buildings, the new infrastructure.', 'Chinese citizen has increased tremendously.',
  'China just has a very strong inherent ability to do manufacturing well.',
  'I think that, to be totally frank, the', 'So the Tesla Shanghai factory is a gem.',
  "It's beautiful, actually, if anyone's ever been there.",
  "I mean, it's pretty cool because we designed the car to look futuristic.",
  "Because I think from a fashion standpoint, we don't",
  'want the aesthetics of the street to stay stagnant.',
  'Well we have the cyber cab which has as you',
  'know has no steering wheel or pedals or side mirrors',
  'or rear view mirror operating commercially in Texas right now',
  'I mean the rate of AI software improvements and major announcements is so rapid',
  "that it makes my head spin, you know,",
];
const STOP = new Set(['the','and','for','with','that','this','from','have','has','had','you','your','are','was','were','not','but','what','when','where','who','why','how','all','can','will','just','like','about','into','out','over','again','then','than','them','they','their','there','here','because','very','really','much','more','most','some','any','get','got','going','go','goes','been','being','would','could','should','shall','may','might','must','do','does','did','done','is','it','its','i','he','she','we','on','in','at','to','of','a','an','so','if','or','as','up','down','off','no','yes','ok','okay','oh','yeah','know','knows','say','says','said','see','saw','seen','look','looks','think','thinks','thought','want','wants','need','needs','make','makes','made','take','takes','took','come','comes','came','right','good','bad','day','days','time','times','thing','things','one','two','three','new','now','us','im','ive','ill','dont','cant','didnt','wont','isnt','wasnt','werent','arent','youre','hes','shes','theyre','whats','thats','guys','guy','girl','boy','people','person','man','woman','men','women','kids','child','children','home','house','work','works','way','ways','lot','lots','little','big','long','short','well','actually','pretty','quite']);
function tokens(s) { return String(s).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []; }
function bag(a) { const m = new Map(); for (const x of a) m.set(x, (m.get(x) || 0) + 1); return m; }
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function score(gtText, hypText) {
  const gt = tokens(gtText), hyp = tokens(hypText), gb = bag(gt), hb = bag(hyp);
  let hits = 0; for (const [k, v] of gb) hits += Math.min(v, hb.get(k) || 0);
  let tp = 0; for (const [k, v] of hb) if (gb.has(k)) tp += Math.min(v, gb.get(k));
  const cg = gt.filter(w => !STOP.has(w));
  const ch = cg.reduce((s, w) => s + (hb.get(w) ? 1 : 0), 0);
  const gs = new Set(gt), hs = new Set(hyp);
  return {
    recall: hits / gt.length, precision: hyp.length ? tp / hyp.length : 0,
    contentRecall: cg.length ? ch / cg.length : 1,
    uniqRecall: gs.size ? [...gs].filter(w => hs.has(w)).length / gs.size : 1,
    cer: lev(gt.join(' '), hyp.join(' ')) / gt.join(' ').length,
    missed: [...gs].filter(w => !hs.has(w)),
  };
}
const det = [];
for (let i = 0; i < 20; i++) det.push({ file: v5[i].file, ...score(GT[i], v5[i].text), ms: v5[i].ms });
const avg = k => det.reduce((s, d) => s + d[k], 0) / det.length;
const sum = { recall: avg('recall'), precision: avg('precision'), contentRecall: avg('contentRecall'), uniqRecall: avg('uniqRecall'), cer: avg('cer'), avgMs: avg('ms') };
const pct = x => (x * 100).toFixed(1) + '%';
console.log('=== 全部方案对比（20张）===');
console.log('方案                  目标词召回  内容词召回  精确率    CER     平均耗时');
const A = old.summary.pathA, B = old.summary.pathB;
console.log('原路径A(放大+灰度)    ', pct(A.recall).padStart(7), pct(A.contentRecall).padStart(8), pct(A.precision).padStart(8), pct(A.cer).padStart(7), A.avgMs.toFixed(0) + 'ms');
console.log('原路径B(无预处理)     ', pct(B.recall).padStart(7), pct(B.contentRecall).padStart(8), pct(B.precision).padStart(8), pct(B.cer).padStart(7), B.avgMs.toFixed(0) + 'ms');
console.log('v5(定位+裁剪+二值)    ', pct(sum.recall).padStart(7), pct(sum.contentRecall).padStart(8), pct(sum.precision).padStart(8), pct(sum.cer).padStart(7), sum.avgMs.toFixed(0) + 'ms');
console.log('\n=== v5 每张 ===');
for (const d of det) console.log(d.file, pct(d.recall), pct(d.precision), pct(d.contentRecall), '漏:' + (d.missed.join(',') || '无'));
fs.writeFileSync(path.join(__dir, 'results', 'v5-metrics.json'), JSON.stringify({ v5sum: sum, detail: det }, null, 2));
