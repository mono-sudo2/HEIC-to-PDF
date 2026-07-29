export type CropRect = {
  x: number
  y: number
  w: number
  h: number
}

const MIN_SIZE = 20

/** Schneidet ein Bild pixelgenau zu (Ausgabe PNG). */
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
