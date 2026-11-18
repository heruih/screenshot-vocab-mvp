// 截图词库 —— 手机端 OCR 真机实测 demo
// 与 Node 端同引擎(@gutenye/ocr-browser=PP-OCRv4)、同后处理口径
import * as ort from 'onnxruntime-web'
import Ocr from '@gutenye/ocr-browser'

// ---- onnxruntime-web 运行时配置 ----
// GitHub Pages 不发 COEP 头，SharedArrayBuffer 不可用 -> 强制单线程，避免 worker 失败
ort.env.wasm.numThreads = (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated)
  ? Math.min(navigator.hardwareConcurrency || 1, 4)
  : 1
ort.env.wasm.simd = true
ort.env.wasm.wasmPaths = new URL('ort/', document.baseURI).href

// 位置阈值：Node 固定 800(原图高1206)，换算成比例以便适配不同尺寸
const TOP_RATIO = 800 / 1206

function clean(t) {
  return t
    .replace(/@?YouTube/gi, ' ')
    .replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .replace(/[\u3000-\u303f\uff00-\uffef]/g, ' ')
    .replace(/[®™©_]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

const $ = (id) => document.getElementById(id)
const fmtMs = (n) => n.toFixed(0) + ' ms'
const fmtMB = (n) => (n / 1048576).toFixed(2) + ' MB'

let ocr = null
const status = (msg) => { $('status').textContent = msg }

async function init() {
  const t0 = performance.now()
  status('正在加载 OCR 模型（首次约 16MB，请稍候）…')
  const mb = new URL('models/', document.baseURI).href
  ocr = await Ocr.create({
    models: {
      detectionPath: mb + 'ch_PP-OCRv4_det_infer.onnx',
      recognitionPath: mb + 'ch_PP-OCRv4_rec_infer.onnx',
      dictionaryPath: mb + 'ppocr_keys_v1.txt',
    },
  })
  const initMs = performance.now() - t0
  status('就绪')
  $('initBox').hidden = false
  $('initMs').textContent = fmtMs(initMs)
  // 汇总同源资源实际下载体积
  const total = performance.getEntriesByType('resource')
    .reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0)
  $('loadSize').textContent = fmtMB(total)
  $('pickBtn').disabled = false
}

async function handleFile(file) {
  if (!ocr) return
  const url = URL.createObjectURL(file)
  try {
    const t0 = performance.now()
    const result = await ocr.detect(url)
    const ms = performance.now() - t0

    const h = result.resizedImageHeight
    const rows = result.texts.map((t) => ({
      text: t.text,
      mean: t.mean,
      top: Math.min(...t.box.map((p) => p[1])),
    }))
    const finalText = rows
      .filter((r) => r.top > h * TOP_RATIO)
      .sort((a, b) => a.top - b.top)
      .map((r) => clean(r.text))
      .filter(Boolean)
      .join(' ')

    $('result').hidden = false
    $('detMs').textContent = fmtMs(ms)
    $('lineCount').textContent = result.texts.length
    $('finalText').textContent = finalText || '（底部未识别到英文行）'
    $('rawLines').innerHTML = rows
      .map((r) => `<li><span class="meta">top${Math.round(r.top)} · ${(r.mean * 100).toFixed(0)}%</span> ${r.text}</li>`)
      .join('')
    status('识别完成')
  } catch (e) {
    status('识别失败：' + (e && e.message ? e.message : e))
  } finally {
    URL.revokeObjectURL(url)
  }
}

$('pickBtn').addEventListener('click', () => $('fileInput').click())
$('fileInput').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0]
  if (f) { status('识别中…'); handleFile(f) }
})

init().catch((e) => status('初始化失败：' + (e && e.message ? e.message : e)))
