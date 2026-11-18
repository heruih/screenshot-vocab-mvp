// 诊断 04：底部原始放大 + 二值图 + 白字灰度分布
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
function shotDraw(img, maxEdge) {
  const sc = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  const cv = createCanvas(w, h);
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return { cv, w, h };
}
function isWhite(r, g, b) { return r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45; }
const img = await loadImage(path.join(__dir, 'images', '04.jpg'));
const { cv, w, h } = shotDraw(img, 560);
const yTop = Math.floor(h * 0.70), ch = h - yTop;
const d = cv.getContext('2d').getImageData(0, yTop, w, ch).data;
// 灰度直方图（只看白色判定通过的像素）
const hist = new Array(256).fill(0);
for (let i = 0; i < d.length; i += 4) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  if (isWhite(r, g, b)) {
    const gr = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[gr]++;
  }
}
console.log('04 底部白色像素灰度分布（>=120）:');
for (let g = 120; g < 256; g++) if (hist[g]) console.log(`  g${g}: ${hist[g]}`);
// 原始底部放大
const zoom = createCanvas(w, ch * 3);
const zc = zoom.getContext('2d'); zc.imageSmoothingEnabled = false;
zc.drawImage(cv, 0, yTop, w, ch, 0, 0, w, ch * 3);
fs.writeFileSync(path.join(__dir, 'results', 'zoom-04.png'), zoom.toBuffer('image/png'));
console.log('已导出 zoom-04.png');
