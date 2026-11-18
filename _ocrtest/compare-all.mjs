// tesseract 全版本收口：v2-v7 统一口径对比 + 基线
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
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
const STOP = new Set(['the','and','for','with','that','this','from','have','has','had','you','are','was','were','not','but','what','when','where','who','why','how','all','can','will','just','like','about','into','out','over','then','than','them','they','their','there','here','because','very','really','much','more','most','some','any','get','got','go','goes','been','being','would','could','should','do','does','did','is','it','its','i','he','she','we','on','in','at','to','of','a','an','so','if','or','as','up','down','off','no','oh','yeah','know','say','said','see','saw','seen','look','think','want','need','make','made','take','came','right','good','day','time','thing','one','new','now','us','im','ive','dont','well','actually','pretty']);
const tokens = s => String(s).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
const bag = a => { const m = new Map(); for (const x of a) m.set(x, (m.get(x) || 0) + 1); return m; };
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
  return { recall: hits / gt.length, precision: hyp.length ? tp / hyp.length : 0, contentRecall: cg.length ? ch / cg.length : 1, cer: lev(gt.join(' '), hyp.join(' ')) / gt.join(' ').length };
}
function summarize(rows) {
  const det = rows.map((r, i) => score(GT[i], r.text));
  const avg = k => det.reduce((s, d) => s + d[k], 0) / det.length;
  const ms = rows.reduce((s, r) => s + r.ms, 0) / rows.length;
  return { recall: avg('recall'), precision: avg('precision'), contentRecall: avg('contentRecall'), cer: avg('cer'), ms };
}
const pct = x => (x * 100).toFixed(1) + '%';
console.log('方案                         召回    内容召回  精确率   CER    耗时');
const A = old.summary.pathA, B = old.summary.pathB;
console.log('基线A(放大2x+灰度,不裁剪)   ', pct(A.recall), pct(A.contentRecall), pct(A.precision), pct(A.cer), A.avgMs.toFixed(0) + 'ms');
console.log('基线B(无预处理)             ', pct(B.recall), pct(B.contentRecall), pct(B.precision), pct(B.cer), B.avgMs.toFixed(0) + 'ms');
for (const v of ['v2', 'v3', 'v4', 'v5', 'v6', 'v7']) {
  const rows = JSON.parse(fs.readFileSync(path.join(__dir, 'results', `${v}.json`)), 'utf8');
  const s = summarize(rows);
  console.log(`${v} `.padEnd(29), pct(s.recall), pct(s.contentRecall), pct(s.precision), pct(s.cer), s.ms.toFixed(0) + 'ms');
}
