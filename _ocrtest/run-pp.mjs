// PP-OCR (PP-OCRv4) 20张回归：修正字段 + 英文行筛选
import Ocr from '@gutenye/ocr-node';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const hasCJK = s => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(s);
const latinShare = s => {
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const all = (s.match(/[A-Za-z\u3400-\u9fff]/g) || []).length;
  return all ? letters / all : 0;
};
const ocr = await Ocr.create();
const rows = [];
for (let n = 1; n <= 20; n++) {
  const name = String(n).padStart(2, '0');
  const s = performance.now();
  const result = await ocr.detect(path.join(__dir, 'images', `${name}.jpg`));
  const ms = Math.round(performance.now() - s);
  const lines = result.texts.map(t => ({
    text: t.text, mean: Math.round(t.mean * 100) / 100,
    top: Math.round(Math.min(...t.box.map(p => p[1]))),
    isEnglish: !hasCJK(t.text) && latinShare(t.text) > 0.6,
  }));
  rows.push({ file: `${name}.jpg`, ms, lines });
  console.log(`\n${name}.jpg  ${ms}ms  共${lines.length}行:`);
  for (const l of lines)
    console.log(`   ${l.isEnglish ? '英' : '非'} [top${String(l.top).padStart(4)} conf${l.mean}]  "${l.text}"`);
}
fs.writeFileSync(path.join(__dir, 'results', 'pp-v4.json'), JSON.stringify(rows, null, 2));
console.log('\n已写 results/pp-v4.json');
