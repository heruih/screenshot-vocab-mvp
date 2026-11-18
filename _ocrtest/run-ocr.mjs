// OCR 实测脚本：逐字复刻产品 src/js/09、10 的压缩/预处理/识别链路
// 产品：tesseract.js@5（实测 5.1.1），eng，默认参数
import tesseract from 'tesseract.js';
const { createWorker, recognize } = tesseract;
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dir, 'images');
const OUT_DIR = path.join(__dir, 'results');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- 复刻 09: shotDraw / shotCompress ----
const SHOT_COMPRESS_EDGE = 560, SHOT_COMPRESS_QUALITY = 0.62;
const SHOT_COMPRESS_EDGE_2 = 420, SHOT_COMPRESS_QUALITY_2 = 0.5;
const SHOT_TARGET_BYTES = 120 * 1024;
function shotDraw(img, maxEdge, quality) {
  const sc = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * sc));
  const h = Math.max(1, Math.round(img.height * sc));
  const cv = createCanvas(w, h);
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return cv.toDataURL('image/jpeg', quality);
}
function shotCompress(img) {
  let dataUrl = shotDraw(img, SHOT_COMPRESS_EDGE, SHOT_COMPRESS_QUALITY);
  let second = null;
  if (dataUrl.length > SHOT_TARGET_BYTES) {
    second = shotDraw(img, SHOT_COMPRESS_EDGE_2, SHOT_COMPRESS_QUALITY_2);
    if (second.length < dataUrl.length) dataUrl = second;
  }
  return { dataUrl, usedSecond: second !== null && dataUrl === second };
}

// ---- 复刻 10: ocrPreprocess（放大2倍 + 灰度 + 对比度1.4，最大边2000）----
async function ocrPreprocess(dataUrl) {
  const img = await loadImage(dataUrl);
  let w = img.width * 2, h = img.height * 2;
  const MAXE = 2000;
  if (Math.max(w, h) > MAXE) {
    const k = MAXE / Math.max(w, h);
    w = Math.round(w * k); h = Math.round(h * k);
  }
  const cv = createCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
  let imgData;
  try { imgData = ctx.getImageData(0, 0, w, h); }
  catch (e) { return cv.toDataURL('image/png'); }
  const d = imgData.data, contrast = 1.4, intercept = 128 * (1 - contrast);
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g = g * contrast + intercept;
    if (g < 0) g = 0; else if (g > 255) g = 255;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(imgData, 0, 0);
  return cv.toDataURL('image/png');
}

const files = fs.readdirSync(IMG_DIR).filter(f => f.endsWith('.jpg')).sort();
const rows = [];

// 先准备每张：原图 -> 压缩 -> 预处理
for (const f of files) {
  const img = await loadImage(path.join(IMG_DIR, f));
  const { dataUrl, usedSecond } = shotCompress(img);
  const cImg = await loadImage(dataUrl);
  const pre = await ocrPreprocess(dataUrl);
  rows.push({
    file: f,
    orig: { w: img.width, h: img.height },
    compressed: { w: cImg.width, h: cImg.height, dataUrlLen: dataUrl.length, usedSecond },
    preprocessUrl: pre,
    compressedUrl: dataUrl,
  });
}

// ---- 冷启动：产品高层 Tesseract.recognize（含 worker 新建+语言加载+销毁），仅第1张 ----
const t0 = performance.now();
const cold = await recognize(rows[0].preprocessUrl, 'eng', { logger: () => {} });
const coldMs = Math.round(performance.now() - t0);

// ---- 稳态：复用单个 worker（引擎实际处理耗时），两条路径都跑 ----
const worker = await createWorker('eng', 1, { logger: () => {} });
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  // 路径A：批量导入（预处理后），产品取 data.text 折叠空白
  let s = performance.now();
  const resA = await worker.recognize(r.preprocessUrl);
  const msA = Math.round(performance.now() - s);
  r.pathA = {
    text: String(resA.data.text || '').replace(/\s+/g, ' ').trim(),
    confidence: Math.round((resA.data.confidence || 0) * 10) / 10,
    ms: msA,
  };
  // 路径B：单张框选（压缩原图，不预处理），产品取 confidence>=45 的词
  s = performance.now();
  const resB = await worker.recognize(r.compressedUrl);
  const msB = Math.round(performance.now() - s);
  r.pathB = {
    text: String(resB.data.text || '').replace(/\s+/g, ' ').trim(),
    confidence: Math.round((resB.data.confidence || 0) * 10) / 10,
    wordsKept: (resB.data.words || [])
      .filter(w => w && w.text && Number(w.confidence || 0) >= 45)
      .map(w => String(w.text).replace(/[^A-Za-z']/g, '').replace(/^[']+|[']+$/g, ''))
      .filter(Boolean),
    ms: msB,
  };
  console.log(`${r.file}  A:${msA}ms  B:${msB}ms  "${r.pathA.text.slice(0, 60)}"`);
}
await worker.terminate();

const out = {
  meta: {
    tesseractJs: '5.1.1', lang: 'eng', params: 'default',
    note: 'pathA=批量(放大2x+灰度+对比度1.4)，pathB=单张框选(无预处理)；ms为复用worker的稳态引擎耗时',
    coldStart: { file: rows[0].file, highLevelRecognizeMs: coldMs, text: String(cold.data.text || '').replace(/\s+/g, ' ').trim() },
  },
  rows: rows.map(({ preprocessUrl, compressedUrl, ...keep }) => keep),
};
fs.writeFileSync(path.join(OUT_DIR, 'raw.json'), JSON.stringify(out, null, 2));
console.log('\n冷启动(高层 recognize 端到端):', coldMs, 'ms');
console.log('原始结果已写 results/raw.json');
