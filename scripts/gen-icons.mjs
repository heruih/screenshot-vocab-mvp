// 从 src/pwa/*.svg 生成 PWA 所需 PNG 图标（复用 _engine 里的 sharp）
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sharp = require(path.join(project, '_engine', 'node_modules', 'sharp'));

const pwa = path.join(project, 'src', 'pwa');
const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'apple-touch-icon-180.png', 180],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
];
for (const [src, out, size] of jobs) {
  await sharp(path.join(pwa, src)).resize(size, size).png().toFile(path.join(pwa, out));
  console.log('generated', out, size);
}
