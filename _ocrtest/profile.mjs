// 探测字幕带：分析压缩图每行的亮像素数与平均亮度，定位字幕行
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
function gray(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

for (const name of ['01', '03', '08', '16']) {
  const img = await loadImage(path.join(__dir, 'images', `${name}.jpg`));
  const { cv, w, h } = shotDraw(img, 560, 0.62);
  const id = cv.getContext('2d').getImageData(0, 0, w, h), d = id.data;
  console.log(`\n===== ${name}.jpg  尺寸 ${w}x${h} =====`);
  console.log('y  亮像素数(>200)  均亮度  条形(亮像素/10)');
  for (let y = 0; y < h; y++) {
    let bright = 0, sum = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = gray(d[i], d[i + 1], d[i + 2]);
      sum += g;
      if (g > 200) bright++;
    }
    const bar = '#'.repeat(Math.round(bright / 10));
    if (bright > 8 || y % 8 === 0)
      console.log(String(y).padStart(3), String(bright).padStart(5), String(Math.round(sum / w)).padStart(5), ' ', bar);
  }
}
