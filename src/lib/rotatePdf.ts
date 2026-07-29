import { PDFDocument, degrees } from 'pdf-lib'

/** Dreht alle Seiten um `angle` Grad im Uhrzeigersinn (Standard: 90). */
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

/** Baut eine einseitige PDF aus einem JPEG neu — Drehung ist pixelgenau gespeichert. */
export async function pdfFromJpeg(jpegBlob: Blob): Promise<Blob> {
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer())
  const pdf = await PDFDocument.create()
  const image = await pdf.embedJpg(jpegBytes)
  const page = pdf.addPage([image.width, image.height])
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  })
  const pdfBytes = await pdf.save()
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
}

/** Dreht ein Bild (JPEG/PNG) um `angle` Grad im Uhrzeigersinn. */
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
