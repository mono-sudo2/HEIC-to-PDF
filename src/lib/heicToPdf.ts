import heic2any from 'heic2any'
import { PDFDocument } from 'pdf-lib'

export type HeicImageResult = {
  image: Blob
  preview: Blob
}

/** HEIC → PNG (volle Auflösung) + JPEG-Vorschau. Keine PDF. */
export async function heicToImage(file: File): Promise<HeicImageResult> {
  const converted = await heic2any({
    blob: file,
    toType: 'image/png',
  })

  const pngBlob = Array.isArray(converted) ? converted[0] : converted
  if (!pngBlob) {
    throw new Error(`Konvertierung fehlgeschlagen: ${file.name}`)
  }

  const preview = await imageToJpegPreview(pngBlob)
  return { image: pngBlob, preview }
}

export async function pdfFromImage(imageBlob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await imageBlob.arrayBuffer())
  const pdf = await PDFDocument.create()
  const isPng =
    imageBlob.type.includes('png') ||
    (bytes[0] === 0x89 && bytes[1] === 0x50)

  const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
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

export async function imageToJpegPreview(blob: Blob, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas nicht verfügbar')
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) reject(new Error('Vorschau fehlgeschlagen'))
        else resolve(result)
      },
      'image/jpeg',
      quality,
    )
  })
}

export function heicBasenameToPdfName(filename: string): string {
  return filename.replace(/\.heic$/i, '.pdf').replace(/\.heif$/i, '.pdf')
}
