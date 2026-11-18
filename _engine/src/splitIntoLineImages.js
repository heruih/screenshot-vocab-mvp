// 修复版 splitIntoLineImages：与原逻辑一致，仅补全所有 OpenCV WASM Mat 的释放，
// 解决手机上识别后 WASM 堆不回收、iOS 内存压力导致页面被回收重载的问题。
import cv from '@techstark/opencv-js'
import clipper from 'js-clipper'
import { ImageRaw } from '../node_modules/@gutenye/ocr-browser/build/ImageRaw.js'

export async function splitIntoLineImages(image, sourceImage) {
  const w = image.width
  const h = image.height
  const edgeRect = []

  const src = cv.matFromImageData(image)
  cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0)
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

  for (let i = 0; i < contours.size(); i++) {
    const minSize = 3
    const cnt = contours.get(i)
    const { points, sside } = getMiniBoxes(cnt)
    cnt.delete()
    if (sside < minSize) continue

    const clipBox = unclip(points)
    const boxMap = cv.matFromArray(clipBox.length / 2, 1, cv.CV_32SC2, clipBox)
    const resultObj = getMiniBoxes(boxMap)
    boxMap.delete()
    const box = resultObj.points
    if (resultObj.sside < minSize + 2) continue

    const clip = (n, min, max) => Math.max(min, Math.min(n, max))
    const rx = sourceImage.width / w
    const ry = sourceImage.height / h
    for (let k = 0; k < box.length; k++) {
      box[k][0] *= rx
      box[k][1] *= ry
    }
    const box1 = orderPointsClockwise(box)
    box1.forEach((item) => {
      item[0] = clip(Math.round(item[0]), 0, sourceImage.width)
      item[1] = clip(Math.round(item[1]), 0, sourceImage.height)
    })
    const rect_width = int(linalgNorm(box1[0], box1[1]))
    const rect_height = int(linalgNorm(box1[0], box1[3]))
    if (rect_width <= 3 || rect_height <= 3) continue

    const c = getRotateCropImage(sourceImage, box)
    edgeRect.push({ box, image: c })
  }

  src.delete()
  contours.delete()
  hierarchy.delete()
  return edgeRect
}

function getMiniBoxes(contour) {
  const boundingBox = cv.minAreaRect(contour)
  const points = Array.from(
    boxPoints(boundingBox.center, boundingBox.size, boundingBox.angle)
  ).sort((a, b) => a[0] - b[0])

  let index_1 = 0, index_2 = 1, index_3 = 2, index_4 = 3
  if (points[1][1] > points[0][1]) { index_1 = 0; index_4 = 1 }
  else { index_1 = 1; index_4 = 0 }
  if (points[3][1] > points[2][1]) { index_2 = 2; index_3 = 3 }
  else { index_2 = 3; index_3 = 2 }

  const box = [points[index_1], points[index_2], points[index_3], points[index_4]]
  const side = Math.min(boundingBox.size.height, boundingBox.size.width)
  return { points: box, sside: side }
}

function unclip(box) {
  const unclip_ratio = 1.5
  const area = Math.abs(polygonPolygonArea(box))
  const length = polygonPolygonLength(box)
  const distance = (area * unclip_ratio) / length
  const tmpArr = []
  box.forEach((item) => tmpArr.push({ X: item[0], Y: item[1] }))
  const offset = new clipper.ClipperOffset()
  offset.AddPath(tmpArr, clipper.JoinType.jtRound, clipper.EndType.etClosedPolygon)
  const expanded = []
  offset.Execute(expanded, distance)
  let expandedArr = []
  if (expanded[0]) {
    expanded[0].forEach((item) => expandedArr.push([item.X, item.Y]))
  }
  expandedArr = [].concat(...expandedArr)
  return expandedArr
}

function orderPointsClockwise(pts) {
  const rect = [[0,0],[0,0],[0,0],[0,0]]
  const s = pts.map((pt) => pt[0] + pt[1])
  rect[0] = pts[s.indexOf(Math.min(...s))]
  rect[2] = pts[s.indexOf(Math.max(...s))]
  const tmp = pts.filter((pt) => pt !== rect[0] && pt !== rect[2])
  const diff = tmp[1].map((e, i) => e - tmp[0][i])
  rect[1] = tmp[diff.indexOf(Math.min(...diff))]
  rect[3] = tmp[diff.indexOf(Math.max(...diff))]
  return rect
}

function linalgNorm(p0, p1) {
  return Math.sqrt(Math.pow(p0[0] - p1[0], 2) + Math.pow(p0[1] - p1[1], 2))
}

function int(num) {
  return num > 0 ? Math.floor(num) : Math.ceil(num)
}

function getRotateCropImage(imageRaw, points) {
  const img_crop_width = int(Math.max(linalgNorm(points[0], points[1]), linalgNorm(points[2], points[3])))
  const img_crop_height = int(Math.max(linalgNorm(points[0], points[3]), linalgNorm(points[1], points[2])))
  const pts_std = [[0,0],[img_crop_width,0],[img_crop_width,img_crop_height],[0,img_crop_height]]

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, flatten(points))
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, flatten(pts_std))
  const M = cv.getPerspectiveTransform(srcTri, dstTri)
  const src = cv.matFromImageData(imageRaw)
  const dst = new cv.Mat()
  cv.warpPerspective(src, dst, M, new cv.Size(img_crop_width, img_crop_height),
    cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar())

  let outMat = dst
  let rotM = null
  if (dst.rows / dst.cols >= 1.5) {
    const dst_rot = new cv.Mat()
    rotM = cv.getRotationMatrix2D(new cv.Point(dst.cols / 2, dst.cols / 2), 90, 1)
    cv.warpAffine(dst, dst_rot, rotM, new cv.Size(dst.rows, dst.cols),
      cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar())
    outMat = dst_rot
    dst.delete()
  }

  // ImageRaw 构造会复制像素，因此原 Mat 在此之后可安全释放
  const result = new ImageRaw({
    data: Uint8ClampedArray.from(outMat.data),
    width: outMat.cols,
    height: outMat.rows,
  })

  src.delete()
  srcTri.delete()
  dstTri.delete()
  M.delete()
  if (rotM) rotM.delete()
  outMat.delete()
  return result
}

function boxPoints(center, size, angle) {
  const width = size.width
  const height = size.height
  const theta = (angle * Math.PI) / 180
  const cosTheta = Math.cos(theta)
  const sinTheta = Math.sin(theta)
  const cx = center.x
  const cy = center.y
  const dx = width * 0.5
  const dy = height * 0.5
  const rotatedPoints = []
  rotatedPoints.push([cx - dx * cosTheta + dy * sinTheta, cy - dx * sinTheta - dy * cosTheta])
  rotatedPoints.push([cx + dx * cosTheta + dy * sinTheta, cy + dx * sinTheta - dy * cosTheta])
  rotatedPoints.push([cx + dx * cosTheta - dy * sinTheta, cy + dx * sinTheta + dy * cosTheta])
  rotatedPoints.push([cx - dx * cosTheta - dy * sinTheta, cy - dx * sinTheta + dy * cosTheta])
  return rotatedPoints
}

function polygonPolygonArea(polygon) {
  let i = -1
  const n = polygon.length
  let a
  let b = polygon[n - 1]
  let area = 0
  while (++i < n) {
    a = b
    b = polygon[i]
    area += a[1] * b[0] - a[0] * b[1]
  }
  return area / 2
}

function polygonPolygonLength(polygon) {
  let i = -1
  const n = polygon.length
  let xa, ya
  let b = polygon[n - 1]
  let xb = b[0]
  let yb = b[1]
  let perimeter = 0
  while (++i < n) {
    xa = xb
    ya = yb
    b = polygon[i]
    xa -= b[0]
    ya -= b[1]
    perimeter += Math.hypot(xa, ya)
  }
  return perimeter
}

function flatten(arr) {
  return arr.toString().split(',').map((item) => +item)
}
