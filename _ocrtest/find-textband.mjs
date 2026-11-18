// 通用文字行带定位：颜色过滤后，按行白色像素水平跨度找"宽行"，聚类成文字带
import { createCanvas, loadImage } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
function isWhite(r, g, b) { return r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45; }
function shotDraw(img, maxEdge) {
  const sc = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  const cv = createCanvas(w, h);
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return { cv, w, h };
}
function findTextBand(cv, w, h) {
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
    rows.push({ wide: cnt >= 8 && (xMax - xMin + 1) >= spanThr, cnt, xMin, xMax });
  }
  // 阶段1：小间隔(3)聚类得到原始带
  const raw = [];
  let cur = null, gap = 0;
  for (let y = 0; y < ch; y++) {
    if (rows[y].wide) {
      if (!cur) cur = { top: y, bot: y }; else cur.bot = y;
      gap = 0;
    } else if (cur) {
      if (++gap > 3) { raw.push(cur); cur = null; gap = 0; }
    }
  }
  if (cur) raw.push(cur);
  // 过滤高度<5 的噪声带
  const valid = raw.filter(b => b.bot - b.top + 1 >= 5);
  // 阶段2：大间隔(15)合并邻近有效带（两行字幕）
  const merged = [];
  for (const b of valid) {
    const last = merged[merged.length - 1];
    if (last && b.top - last.bot <= 15) last.bot = b.bot;
    else merged.push({ ...b });
  }
  const pick = merged[0] || null;
  return { yTop, ch, bands: pick ? [pick] : [], all: merged, rows };
}
for (let n = 1; n <= 20; n++) {
  const name = String(n).padStart(2, '0');
  const img = await loadImage(path.join(__dir, 'images', `${name}.jpg`));
  const { cv, w, h } = shotDraw(img, 560);
  const { yTop, bands } = findTextBand(cv, w, h);
  const desc = bands.map(b => `[绝对${yTop + b.top}-${yTop + b.bot} 高${b.bot - b.top + 1}]`).join(' ');
  console.log(`${name}  文字带: ${desc || '未检测到'}`);
}
