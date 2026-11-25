import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The published bundle includes the existing OCR dependencies. Mirror the small
// change in _engine/src/engine.js when rebuilding with npm dependencies is unavailable.
const BASE_BUNDLE = '0d52707130b6ec26f65ce20b84ccfde6aa3cf25545d85a45b16be304a19098f7';
export async function prepareOcrEngine(output){
  const assets = join(output, 'ocr-assets');
  let bytes;
  try{
    bytes = await readFile(join(assets, 'ocr-engine.mjs'));
  }catch(error){
    if(error.code==='ENOENT') return false;
    throw error;
  }
  if(createHash('sha256').update(bytes).digest('hex')!==BASE_BUNDLE){
    throw new Error('OCR 基础包版本变化，请按 _engine/src/engine.js 重建引擎');
  }
  const changes = [
    ['async function sa(A){if(!ID)throw new Error("engine-not-ready")',
      'async function sa(A,allRows=false){if(!ID)throw new Error("engine-not-ready")'],
    ['.filter(g=>g.top>C*yF)', '.filter(g=>allRows||g.top>C*yF)'],
    ['export{Ja as init,sa as recognize};',
      'const recognizeWholeImage=A=>sa(A,true);export{Ja as init,sa as recognize,recognizeWholeImage};']
  ];
  let bundle = bytes.toString('utf8');
  for(const [before,after] of changes){
    const position=bundle.indexOf(before);
    if(position<0||bundle.indexOf(before,position+1)!==-1) throw new Error('OCR 基础包缺少预期的入口');
    bundle=bundle.replace(before,after);
  }
  await writeFile(join(assets, 'ocr-engine-region-v1.mjs'), bundle, 'utf8');
  return true;
}
