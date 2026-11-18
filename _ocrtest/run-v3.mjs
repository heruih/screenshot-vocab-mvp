// v3：底部裁剪 + 颜色过滤(黄色置黑) + Otsu 自适应二值化
import tesseract from 'tesseract.js';
const { createWorker } = tesseract;
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));

const BOTTOM = 0.70;
function isWhite(r, g, b) { return r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45; }
function isYellow(r, g, b) { return r > 170 && g > 140 && b < 110; }
function shotDraw(img, maxEdge) {
  const sc = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  const cv = createCanvas(w, h);
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return { cv, w, h };
}
function otsu(gray, n) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxV = 0, thr = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxV) { maxV = between; thr = t; }
  }
  return thr;
}
function v3Image(img) {
  const { cv, w, h } = shotDraw(img, 560);
  const yTop = Math.floor(h * BOTTOM), ch = h - yTop;
  const src = cv.getContext('2d').getImageData(0, yTop, w, ch).data;
  // 白字保留灰度；黄色中文置 0；其余背景保留真实灰度（供 Otsu 区分背景/文字）
  const gray = new Uint8Array(w * ch);
  for (let i = 0, k = 0; i < src.length; i += 4, k++) {
    const r = src[i], g = src[i + 1], b = src[i + 2];
    const gr = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    gray[k] = isWhite(r, g, b) ? gr : isYellow(r, g, b) ? 0 : gr;
  }
  const thr = otsu(gray, gray.length);
  const out = createCanvas(w, ch);
  const ctx = out.getContext('2d');
  const id = ctx.createImageData(w, ch), d = id.data;
  for (let k = 0, p = 0; k < gray.length; k++, p += 4) {
    const on = gray[k] > thr ? 255 : 0;
    d[p] = d[p + 1] = d[p + 2] = on; d[p + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return { canvas: out, w, ch, thr };
}
const worker = await createWorker('eng', 1, { logger: () => {} });
const rows = [];
for (let n = 1; n <= 20; n++) {
  const name = String(n).padStart(2, '0');
  const img = await loadImage(path.join(__dir, 'images', `${name}.jpg`));
  const { canvas, thr } = v3Image(img);
  const s = performance.now();
  const res = await worker.recognize(canvas.toDataURL('image/png'));
  const ms = Math.round(performance.now() - s);
  const text = String(res.data.text || '').replace(/\s+/g, ' ').trim();
  rows.push({ file: `${name}.jpg`, otsuThr: thr, text, confidence: Math.round(res.data.confidence * 10) / 10, ms });
  if ([1, 4, 8, 18].includes(n))
    fs.writeFileSync(path.join(__dir, 'results', `v3-bin-${name}.png`), canvas.toBuffer('image/png'));
  console.log(`${name}.jpg  thr${String(thr).padStart(3)}  ${ms}ms  "${text.slice(0, 68)}"`);
}
await worker.terminate();
fs.writeFileSync(path.join(__dir, 'results', 'v3.json'), JSON.stringify(rows, null, 2));
