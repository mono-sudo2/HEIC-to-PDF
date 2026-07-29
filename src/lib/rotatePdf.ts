import { PDFDocument, degrees } from 'pdf-lib'

/** Dreht alle PDF-Seiten um 90° (Metadaten) — Bilddaten bleiben unverändert. */
export async function rotatePdf(blob: Blob, angle = 90): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const pdf = await PDFDocument.load(bytes)

  for (const page of pdf.getPages()) {
    const current = page.getRotation().angle
    page.setRotation(degrees((((current + angle) % 360) + 360) % 360))
  }

  const pdfBytes = await pdf.save()
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
}

/** Dreht ein Vorschaubild um 90° (nur UI). */
export async function rotateImageBlob(blob: Blob, angle = 90): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const normalized = ((angle % 360) + 360) % 360
  const swap = normalized === 90 || normalized === 270
  const width = swap ? bitmap.height : bitmap.width
  const height = swap ? bitmap.width : bitmap.height

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas nicht verfügbar')
  }

  ctx.translate(width / 2, height / 2)
  ctx.rotate((normalized * Math.PI) / 180)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) reject(new Error('Bild-Rotation fehlgeschlagen'))
        else resolve(result)
      },
      'image/jpeg',
      0.92,
    )
  })
}
