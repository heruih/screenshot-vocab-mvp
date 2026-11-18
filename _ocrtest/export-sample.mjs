// 一次性：导出 01 张的压缩图和预处理图，肉眼确认噪声来源
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));

function shotDraw(img, maxEdge, quality) {
  const sc = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  const cv = createCanvas(w, h);
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return { dataUrl: cv.toDataURL('image/jpeg', quality), w, h };
}
async function preprocess(dataUrl) {
  const img = await loadImage(dataUrl);
  let w = img.width * 2, h = img.height * 2;
  const cv = createCanvas(w, h); const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  const contrast = 1.4, intercept = 128 * (1 - contrast);
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g = g * contrast + intercept; if (g < 0) g = 0; else if (g > 255) g = 255;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(id, 0, 0);
  return cv.toDataURL('image/png');
}
const orig = await loadImage(path.join(__dir, 'images', '01.jpg'));
const { dataUrl } = shotDraw(orig, 560, 0.62);
const pre = await preprocess(dataUrl);
fs.writeFileSync(path.join(__dir, 'results', '01-compressed.jpg'), Buffer.from(dataUrl.split(',')[1], 'base64'));
fs.writeFileSync(path.join(__dir, 'results', '01-preprocessed.png'), Buffer.from(pre.split(',')[1], 'base64'));
console.log('done');
