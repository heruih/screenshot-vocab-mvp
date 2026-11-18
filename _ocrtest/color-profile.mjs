// 颜色诊断：底部区域每行的白色像素 vs 黄色像素，验证白字/黄字可分性
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
for (const name of ['01', '03', '08']) {
  const img = await loadImage(path.join(__dir, 'images', `${name}.jpg`));
  const { cv, w, h } = shotDraw(img, 560, 0.62);
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  console.log(`\n=== ${name} (${w}x${h}) 底部 y>=170 ===`);
  console.log(' y   白(无色偏)  黄(B低)  行均亮');
  for (let y = 170; y < h; y++) {
    let white = 0, yellow = 0, sum = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      sum += (r + g + b) / 3;
      if (r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45) white++;
      else if (r > 170 && g > 140 && b < 110) yellow++;
    }
    if (white > 5 || yellow > 5)
      console.log(String(y).padStart(3), String(white).padStart(5), String(yellow).padStart(6), ' ', Math.round(sum / w));
  }
}
