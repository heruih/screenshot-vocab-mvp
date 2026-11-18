// v8：定位裁剪 + 颜色过滤(黑底灰度白字) + 平滑放大2倍
import tesseract from 'tesseract.js';
const { createWorker } = tesseract;
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const PAD = 3, SCALE = 2;
function isWhite(r, g, b) { return r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45; }
function shotDraw(img, maxEdge) {
  const sc = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  const cv = createCanvas(w, h);
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return { cv, w, h };
}
function locateBand(cv, w, h) {
  const yTop = Math.floor(h * 0.70), ch = h - yTop;
  const d = cv.getContext('2d').getImageData(0, yTop, w, ch).data;
  const spanThr = 0.18 * w;
  const rows = [];
  for (let y = 0; y < ch; y++) {
    let cnt = 0, xMin = w, xMax = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isWhite(d[i], d[i + 1], d[i + 2])) { cnt++; xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
    }
    rows.push({ wide: cnt >= 8 && (xMax - xMin + 1) >= spanThr });
  }
  const raw = []; let cur = null, gap = 0;
  for (let y = 0; y < ch; y++) {
    if (rows[y].wide) { if (!cur) cur = { top: y, bot: y }; else cur.bot = y; gap = 0; }
    else if (cur && ++gap > 3) { raw.push(cur); cur = null; gap = 0; }
  }
  if (cur) raw.push(cur);
  const valid = raw.filter(b => b.bot - b.top + 1 >= 5);
  const merged = [];
  for (const b of valid) {
    const last = merged[merged.length - 1];
    if (last && b.top - last.bot <= 15) last.bot = b.bot; else merged.push({ ...b });
  }
  const pick = merged[0];
  if (!pick) return null;
  return { y1: Math.max(0, yTop + pick.top - PAD), y2: Math.min(h - 1, yTop + pick.bot + PAD) };
}
function v8Image(img) {
  const { cv, w, h } = shotDraw(img, 560);
  const band = locateBand(cv, w, h);
  if (!band) return { canvas: cv };
  const bh = band.y2 - band.y1 + 1;
  const src = cv.getContext('2d').getImageData(0, band.y1, w, bh).data;
  // 颜色过滤：黑底 + 灰度白字
  const filt = createCanvas(w, bh);
  const fc = filt.getContext('2d');
  const fid = fc.createImageData(w, bh), fd = fid.data;
  for (let i = 0, p = 0; i < src.length; i += 4, p += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2];
    const gr = isWhite(r, g, b) ? Math.round(0.299 * r + 0.587 * g + 0.114 * b) : 0;
    fd[p] = fd[p + 1] = fd[p + 2] = gr; fd[p + 3] = 255;
  }
  fc.putImageData(fid, 0, 0);
  // 平滑放大
  const big = createCanvas(w * SCALE, bh * SCALE);
  const bc = big.getContext('2d'); bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high';
  bc.drawImage(filt, 0, 0, w * SCALE, bh * SCALE);
  return { canvas: big };
}
const worker = await createWorker('eng', 1, { logger: () => {} });
const rows = [];
for (let n = 1; n <= 20; n++) {
  const name = String(n).padStart(2, '0');
  const img = await loadImage(path.join(__dir, 'images', `${name}.jpg`));
  const { canvas } = v8Image(img);
  const s = performance.now();
  const res = await worker.recognize(canvas.toDataURL('image/png'));
  const ms = Math.round(performance.now() - s);
  const text = String(res.data.text || '').replace(/\s+/g, ' ').trim();
  rows.push({ file: `${name}.jpg`, text, confidence: Math.round(res.data.confidence * 10) / 10, ms });
  console.log(`${name}.jpg  ${ms}ms  "${text.slice(0, 70)}"`);
}
await worker.terminate();
fs.writeFileSync(path.join(__dir, 'results', 'v8.json'), JSON.stringify(rows, null, 2));
