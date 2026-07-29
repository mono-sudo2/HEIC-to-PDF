export type Point = { x: number; y: number }

/** Viereck in Bildpixeln: oben-links, oben-rechts, unten-rechts, unten-links */
export type CropQuad = {
  tl: Point
  tr: Point
  br: Point
  bl: Point
}

/** @deprecated nur noch für Typ-Kompatibilität — Perspektiv-Crop nutzt CropQuad */
export type CropRect = {
  x: number
  y: number
  w: number
  h: number
}

const MIN_SIZE = 20

function pointDist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function defaultCropQuad(imageWidth: number, imageHeight: number): CropQuad {
  const ix = imageWidth * 0.1
  const iy = imageHeight * 0.1
  return {
    tl: { x: ix, y: iy },
    tr: { x: imageWidth - ix, y: iy },
    br: { x: imageWidth - ix, y: imageHeight - iy },
    bl: { x: ix, y: imageHeight - iy },
  }
}

export function clampPoint(p: Point, imageWidth: number, imageHeight: number): Point {
  return {
    x: Math.max(0, Math.min(imageWidth, p.x)),
    y: Math.max(0, Math.min(imageHeight, p.y)),
  }
}

export function clampCropQuad(
  quad: CropQuad,
  imageWidth: number,
  imageHeight: number,
): CropQuad {
  return {
    tl: clampPoint(quad.tl, imageWidth, imageHeight),
    tr: clampPoint(quad.tr, imageWidth, imageHeight),
    br: clampPoint(quad.br, imageWidth, imageHeight),
    bl: clampPoint(quad.bl, imageWidth, imageHeight),
  }
}

/** Verschiebt das gesamte Viereck ohne Verzerrung, bleibt im Bild. */
export function translateCropQuad(
  quad: CropQuad,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
): CropQuad {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x]
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y]
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const ndx = Math.max(-minX, Math.min(imageWidth - maxX, dx))
  const ndy = Math.max(-minY, Math.min(imageHeight - maxY, dy))
  const move = (p: Point): Point => ({ x: p.x + ndx, y: p.y + ndy })
  return {
    tl: move(quad.tl),
    tr: move(quad.tr),
    br: move(quad.br),
    bl: move(quad.bl),
  }
}

/** Quad relativ 0–1 — überlebt Bildwechsel / andere Auflösungen */
export type NormalizedQuad = {
  tl: Point
  tr: Point
  br: Point
  bl: Point
}

export function normalizeQuad(quad: CropQuad, w: number, h: number): NormalizedQuad {
  const n = (p: Point): Point => ({
    x: w > 0 ? p.x / w : 0,
    y: h > 0 ? p.y / h : 0,
  })
  return { tl: n(quad.tl), tr: n(quad.tr), br: n(quad.br), bl: n(quad.bl) }
}

export function denormalizeQuad(
  norm: NormalizedQuad,
  w: number,
  h: number,
): CropQuad {
  const d = (p: Point): Point => ({ x: p.x * w, y: p.y * h })
  return clampCropQuad(
    { tl: d(norm.tl), tr: d(norm.tr), br: d(norm.br), bl: d(norm.bl) },
    w,
    h,
  )
}

function outputSize(quad: CropQuad): { w: number; h: number } {
  const w = Math.max(pointDist(quad.tl, quad.tr), pointDist(quad.bl, quad.br))
  const h = Math.max(pointDist(quad.tl, quad.bl), pointDist(quad.tr, quad.br))
  return {
    w: Math.max(MIN_SIZE, Math.round(w)),
    h: Math.max(MIN_SIZE, Math.round(h)),
  }
}

/** Homographie dst→src (3×3, row-major, h[8]=1). */
function getPerspectiveTransform(dst: Point[], src: Point[]): Float64Array {
  // 8 equations for h0..h7
  const A: number[][] = []
  const b: number[] = []

  for (let i = 0; i < 4; i++) {
    const { x: dx, y: dy } = dst[i]!
    const { x: sx, y: sy } = src[i]!
    A.push([dx, dy, 1, 0, 0, 0, -sx * dx, -sx * dy])
    b.push(sx)
    A.push([0, 0, 0, dx, dy, 1, -sy * dx, -sy * dy])
    b.push(sy)
  }

  const h = solveLinearSystem(A, b)
  return new Float64Array([...h, 1])
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]!])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row]![col]!) > Math.abs(M[pivot]![col]!)) pivot = row
    }
    ;[M[col], M[pivot]] = [M[pivot]!, M[col]!]

    const diag = M[col]![col]!
    if (Math.abs(diag) < 1e-12) {
      throw new Error('Ungültiges Zuschneide-Viereck')
    }

    for (let j = col; j <= n; j++) {
      M[col]![j]! /= diag
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = M[row]![col]!
      for (let j = col; j <= n; j++) {
        M[row]![j]! -= factor * M[col]![j]!
      }
    }
  }

  return M.map((row) => row[n]!)
}

function applyHomography(H: Float64Array, x: number, y: number): Point {
  const w = H[6]! * x + H[7]! * y + H[8]!
  return {
    x: (H[0]! * x + H[1]! * y + H[2]!) / w,
    y: (H[3]! * x + H[4]! * y + H[5]!) / w,
  }
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
    const xi = Math.max(0, Math.min(width - 1, Math.round(x)))
    const yi = Math.max(0, Math.min(height - 1, Math.round(y)))
    const i = (yi * width + xi) * 4
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
  }

  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const fx = x - x0
  const fy = y - y0

  const i00 = (y0 * width + x0) * 4
  const i10 = (y0 * width + x1) * 4
  const i01 = (y1 * width + x0) * 4
  const i11 = (y1 * width + x1) * 4

  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const v00 = data[i00 + c]!
    const v10 = data[i10 + c]!
    const v01 = data[i01 + c]!
    const v11 = data[i11 + c]!
    const v0 = v00 * (1 - fx) + v10 * fx
    const v1 = v01 * (1 - fx) + v11 * fx
    out[c] = v0 * (1 - fy) + v1 * fy
  }
  return out
}

/**
 * Perspektivisches Zuschneiden: 4 Ecken → gerades Rechteck (PNG).
 */
export async function perspectiveCropImageBlob(
  blob: Blob,
  quad: CropQuad,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const { w: outW, h: outH } = outputSize(quad)

  if (outW < MIN_SIZE || outH < MIN_SIZE) {
    bitmap.close()
    throw new Error('Zuschneidebereich zu klein')
  }

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = bitmap.width
  srcCanvas.height = bitmap.height
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })
  if (!srcCtx) {
    bitmap.close()
    throw new Error('Canvas nicht verfügbar')
  }
  srcCtx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)

  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ]
  const src: Point[] = [quad.tl, quad.tr, quad.br, quad.bl]
  const H = getPerspectiveTransform(dst, src)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = outW
  outCanvas.height = outH
  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) {
    throw new Error('Canvas nicht verfügbar')
  }
  const outImage = outCtx.createImageData(outW, outH)
  const out = outImage.data

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyHomography(H, x, y)
      const [r, g, b, a] = sampleBilinear(
        srcData.data,
        srcCanvas.width,
        srcCanvas.height,
        p.x,
        p.y,
      )
      const i = (y * outW + x) * 4
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = a
    }
  }

  outCtx.putImageData(outImage, 0, 0)

  return new Promise((resolve, reject) => {
    outCanvas.toBlob(
      (result) => {
        if (!result) reject(new Error('Zuschneiden fehlgeschlagen'))
        else resolve(result)
      },
      'image/png',
    )
  })
}

/** Achsenparalleler Crop (Fallback). */
export async function cropImageBlob(blob: Blob, rect: CropRect): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const w = Math.min(bitmap.width - x, Math.floor(rect.w))
  const h = Math.min(bitmap.height - y, Math.floor(rect.h))

  if (w < MIN_SIZE || h < MIN_SIZE) {
    bitmap.close()
    throw new Error('Zuschneidebereich zu klein')
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas nicht verfügbar')
  }

  ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) reject(new Error('Zuschneiden fehlgeschlagen'))
        else resolve(result)
      },
      'image/png',
    )
  })
}

export function clampCropRect(
  rect: CropRect,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  let { x, y, w, h } = rect
  w = Math.max(MIN_SIZE, Math.min(w, imageWidth))
  h = Math.max(MIN_SIZE, Math.min(h, imageHeight))
  x = Math.max(0, Math.min(x, imageWidth - w))
  y = Math.max(0, Math.min(y, imageHeight - h))
  return { x, y, w, h }
}
