import Ocr from '@gutenye/ocr-node';
import path from 'path';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const ocr = await Ocr.create();
const result = await ocr.detect(path.join(__dir, 'images', '01.jpg'));
console.log('keys:', Object.keys(result));
console.log('texts length:', result.texts.length);
console.log(JSON.stringify(result.texts, null, 2).slice(0, 3000));
