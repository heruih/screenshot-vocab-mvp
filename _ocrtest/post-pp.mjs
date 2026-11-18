// PP-OCR 后处理：位置过滤(只留底部) + 混合行清洗(剥离中文/水印) + 指标
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const pp = JSON.parse(fs.readFileSync(path.join(__dir, 'results', 'pp-v4.json')), 'utf8');
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
const TOP_LIMIT = 800; // 原图高1206，只留底部字幕行
function clean(t) {
  return t
    .replace(/@?YouTube/gi, ' ')
    .replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .replace(/[\u3000-\u303f\uff00-\uffef]/g, ' ')
    .replace(/[®™©_]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const det = [];
for (let i = 0; i < 20; i++) {
  const hyp = pp[i].lines
    .filter(l => l.top > TOP_LIMIT)
    .sort((a, b) => a.top - b.top)
    .map(l => clean(l.text))
    .filter(Boolean).join(' ');
  det.push({ file: pp[i].file, hyp, ...score(GT[i], hyp), ms: pp[i].ms });
}
const avg = k => det.reduce((s, d) => s + d[k], 0) / det.length;
const sum = { recall: avg('recall'), precision: avg('precision'), contentRecall: avg('contentRecall'), cer: avg('cer'), ms: avg('ms') };
const pct = x => (x * 100).toFixed(1) + '%';
console.log('=== 引擎最终对比（20张）===');
console.log('方案                    召回    内容召回  精确率   CER    耗时');
const A = old.summary.pathA;
console.log('tesseract基线A         ', pct(A.recall), pct(A.contentRecall), pct(A.precision), pct(A.cer), A.avgMs.toFixed(0) + 'ms');
console.log('PP-OCRv4(位置+清洗)    ', pct(sum.recall), pct(sum.contentRecall), pct(sum.precision), pct(sum.cer), sum.ms.toFixed(0) + 'ms');
console.log('\n=== PP-OCR 每张 ===');
for (const d of det) console.log(d.file, pct(d.recall), pct(d.precision), pct(d.cer), ' "' + d.hyp + '"');
fs.writeFileSync(path.join(__dir, 'results', 'pp-metrics.json'), JSON.stringify({ sum, detail: det }, null, 2));
