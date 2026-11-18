// 放大 08、03 底部区域，确认黑条边界与白色水印的位置关系
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
for (const name of ['08', '03']) {
  const img = await loadImage(path.join(__dir, 'images', `${name}.jpg`));
  const { cv, w, h } = shotDraw(img, 560, 0.62);
  const yTop = 165;
  const bandH = h - yTop;
  const out = createCanvas(w, bandH * 3);
  const c = out.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(cv, 0, yTop, w, bandH, 0, 0, w, bandH * 3);
  const buf = out.toBuffer('image/png');
  (await import('fs')).writeFileSync(path.join(__dir, 'results', `zoom-${name}.png`), buf);
}
console.log('done');
