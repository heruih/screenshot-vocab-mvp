// 底部字幕带自动检测（诊断用，先不识别）：在底部区域按行亮像素聚类文字行
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

const START = 0.66;      // 只在底部 34% 搜索
const G_THR = 175;       // 亮像素灰度阈值
const ROW_THR = 12;      // 一行亮像素达到该数算文字行
const GAP = 3;           // 行段间允许的小间隔
const PAD = 3;

for (let n = 1; n <= 20; n++) {
  const name = String(n).padStart(2, '0');
  const img = await loadImage(path.join(__dir, 'images', `${name}.jpg`));
  const { cv, w, h } = shotDraw(img, 560, 0.62);
  const id = cv.getContext('2d').getImageData(0, 0, w, h), d = id.data;
  const y0 = Math.floor(h * START);
  const rows = [];
  for (let y = y0; y < h; y++) {
    let bright = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (gray(d[i], d[i + 1], d[i + 2]) > G_THR) bright++;
    }
    rows.push(bright);
  }
  // 聚类文字行
  const segs = [];
  let cur = null, gapC = 0;
  for (let k = 0; k < rows.length; k++) {
    const y = y0 + k, isRow = rows[k] >= ROW_THR;
    if (isRow) {
      if (!cur) cur = { top: y, bot: y };
      else { cur.bot = y; gapC = 0; }
    } else if (cur) {
      gapC++;
      if (gapC > GAP) { segs.push(cur); cur = null; gapC = 0; }
    }
  }
  if (cur) segs.push(cur);
  const crop = segs.length ? { top: Math.max(0, segs[0].top - PAD), bot: Math.min(h - 1, segs[segs.length - 1].bot + PAD) } : null;
  console.log(`${name}  段:[${segs.map(s => `${s.top}-${s.bot}`).join(', ') || '无'}]  裁剪:${crop ? `${crop.top}-${crop.bot} (高${crop.bot - crop.top + 1})` : '无'}`);
}
