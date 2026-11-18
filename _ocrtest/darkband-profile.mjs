// 黑条边界探测：底部每行的暗像素比例/均亮度/白字数，定位黑条上下边界
import { createCanvas, loadImage } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
function shotDraw(img, maxEdge, quality) {
  const sc = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  const cv = createCanvas(w, h);
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return { cv, w, h };
}
function isWhite(r, g, b) { return r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45; }
for (const name of ['08', '03', '01']) {
  const img = await loadImage(path.join(__dir, 'images', `${name}.jpg`));
  const { cv, w, h } = shotDraw(img, 560, 0.62);
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  console.log(`\n=== ${name} 底部 y160-${h - 1} ===`);
  console.log(' y  darkRatio  均亮  白字  条(暗比例)');
  for (let y = 160; y < h; y++) {
    let dark = 0, white = 0, sum = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const gr = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += gr; if (gr < 75) dark++; if (isWhite(r, g, b)) white++;
    }
    console.log(String(y).padStart(3), String((dark / w).toFixed(2)).padStart(6), String(Math.round(sum / w)).padStart(4), String(white).padStart(4), ' ', '#'.repeat(Math.round((dark / w) * 20)));
  }
}
