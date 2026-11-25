// 独立 PP-OCR 引擎入口：ESM 打包后 export init/recognize，
// 产品单 HTML 通过动态 import() 加载，再调用 init / recognize。
import * as ort from 'onnxruntime-web'
import Ocr, { registerBackend } from '@gutenye/ocr-browser'
import { FileUtils } from '../node_modules/@gutenye/ocr-browser/build/FileUtils.js'
import { ImageRaw } from '../node_modules/@gutenye/ocr-browser/build/ImageRaw.js'
import { splitIntoLineImages as splitFixed } from './splitIntoLineImages.js'

// GitHub Pages 无 COEP -> SharedArrayBuffer 不可用 -> 强制单线程
ort.env.wasm.numThreads = (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated)
  ? Math.min(navigator.hardwareConcurrency || 1, 4)
  : 1
ort.env.wasm.simd = true

// 用修复版轮廓处理覆盖（补全 OpenCV 内存释放）
registerBackend({
  FileUtils,
  ImageRaw,
  InferenceSession: ort.InferenceSession,
  splitIntoLineImages: splitFixed,
  defaultModels: undefined,
})

// 位置阈值：只保留底部字幕区域
const TOP_RATIO = 800 / 1206
function clean(t) {
  return t
    .replace(/@?YouTube/gi, ' ')
    .replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ')
    .replace(/[　-〿＀-￯]/g, ' ')
    .replace(/[®™©_]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

let ocr = null
let ready = false

async function init({ wasmPaths, modelBase }) {
  if (ready) return
  ort.env.wasm.wasmPaths = wasmPaths
  ocr = await Ocr.create({
    models: {
      detectionPath: modelBase + 'ch_PP-OCRv4_det_infer.onnx',
      recognitionPath: modelBase + 'ch_PP-OCRv4_rec_infer.onnx',
      dictionaryPath: modelBase + 'ppocr_keys_v1.txt',
    },
  })
  ready = true
}

async function recognize(blobUrl, allRows = false) {
  if (!ready) throw new Error('engine-not-ready')
  const result = await ocr.detect(blobUrl)
  const h = result.resizedImageHeight
  const rows = result.texts.map((t) => ({
    text: t.text,
    mean: t.mean,
    top: Math.min(...t.box.map((p) => p[1])),
  }))
  return rows
    .filter((r) => allRows || r.top > h * TOP_RATIO)
    .sort((a, b) => a.top - b.top)
    .map((r) => clean(r.text))
    .filter(Boolean)
    .join(' ')
}

function recognizeWholeImage(blobUrl) {
  return recognize(blobUrl, true)
}

export { init, recognize, recognizeWholeImage }
