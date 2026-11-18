// 新方案 v2：底部区域裁剪 + 颜色过滤(只留白色，剔除黄色中文) + 二值化
import tesseract from 'tesseract.js';
const { createWorker } = tesseract;
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));

const BOTTOM = 0.70;   // 只保留底部 30%
const G_MIN = 150;     // 白字灰度下限
function isWhite(r, g, b) {
  return r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45;
}
function shotDraw(img, maxEdge, quality) {
  const sc = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  const cv = createCanvas(w, h);
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return { cv, w, h };
}
function v2Image(img) {
  const { cv, w, h } = shotDraw(img, 560, 0.62);
  const yTop = Math.floor(h * BOTTOM);
  const ch = h - yTop;
  const out = createCanvas(w, ch);
  const ctx = out.getContext('2d');
  const src = cv.getContext('2d').getImageData(0, yTop, w, ch).data;
  const id = ctx.createImageData(w, ch), d = id.data;
  for (let i = 0, p = 0; i < src.length; i += 4, p += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2];
    const gr = 0.299 * r + 0.587 * g + 0.114 * b;
    const on = isWhite(r, g, b) && gr > G_MIN ? 255 : 0;
    d[p] = d[p + 1] = d[p + 2] = on; d[p + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return { canvas: out, w, ch };
}

const worker = await createWorker('eng', 1, { logger: () => {} });
const rows = [];
for (let n = 1; n <= 20; n++) {
  const name = String(n).padStart(2, '0');
  const img = await loadImage(path.join(__dir, 'images', `${name}.jpg`));
  const { canvas, w, ch } = v2Image(img);
  const dataUrl = canvas.toDataURL('image/png');
  const s = performance.now();
  const res = await worker.recognize(dataUrl);
  const ms = Math.round(performance.now() - s);
  const text = String(res.data.text || '').replace(/\s+/g, ' ').trim();
  rows.push({ file: `${name}.jpg`, binSize: `${w}x${ch}`, text, confidence: Math.round(res.data.confidence * 10) / 10, ms });
  if ([1, 3, 8, 16].includes(n))
    fs.writeFileSync(path.join(__dir, 'results', `v2-bin-${name}.png`), canvas.toBuffer('image/png'));
  console.log(`${name}.jpg  ${ms}ms  "${text.slice(0, 70)}"`);
}
await worker.terminate();
fs.writeFileSync(path.join(__dir, 'results', 'v2.json'), JSON.stringify(rows, null, 2));
console.log('\n二值图与结果已写 results/');
