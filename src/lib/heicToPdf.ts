import heic2any from 'heic2any'
import { PDFDocument } from 'pdf-lib'

export type HeicConversionResult = {
  pdf: Blob
  preview: Blob
}

export async function heicToPdf(file: File): Promise<HeicConversionResult> {
  const converted = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.92,
  })

  const jpegBlob = Array.isArray(converted) ? converted[0] : converted
  if (!jpegBlob) {
    throw new Error(`Konvertierung fehlgeschlagen: ${file.name}`)
  }

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
  return {
    pdf: new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
    preview: jpegBlob,
  }
}

export function heicBasenameToPdfName(filename: string): string {
  return filename.replace(/\.heic$/i, '.pdf').replace(/\.heif$/i, '.pdf')
}
