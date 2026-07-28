import { PDFDocument } from 'pdf-lib'

export async function mergePdfs(blobs: Blob[]): Promise<Blob> {
  const merged = await PDFDocument.create()

  for (const blob of blobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    const pages = await merged.copyPages(doc, doc.getPageIndices())
    for (const page of pages) {
      merged.addPage(page)
    }
  }

  const pdfBytes = await merged.save()
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
}

export function mergedPdfFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `merged-${stamp}.pdf`
}
