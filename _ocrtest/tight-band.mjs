// 04 裁剪区逐行白字数 + 水平跨度，定位文字行与大块物体
import { createCanvas, loadImage } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
function isWhite(r, g, b) { return r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45; }
const img = await loadImage(path.join(__dir, 'images', '04.jpg'));
const sc = Math.min(1, 560 / Math.max(img.width, img.height));
const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
const cv = createCanvas(w, h);
cv.getContext('2d').drawImage(img, 0, 0, w, h);
const yTop = Math.floor(h * 0.70), ch = h - yTop;
const d = cv.getContext('2d').getImageData(0, yTop, w, ch).data;
console.log('04 裁剪区逐行（相对y）白字数/水平跨度');
for (let y = 0; y < ch; y++) {
  let cnt = 0, xMin = w, xMax = 0;
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (isWhite(d[i], d[i + 1], d[i + 2])) { cnt++; xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
  }
  if (cnt) console.log(String(y).padStart(3), String(cnt).padStart(4), 'x[' + xMin + '-' + xMax + '] 跨度' + (xMax - xMin + 1));
}
