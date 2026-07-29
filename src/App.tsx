import { useCallback, useEffect, useRef, useState } from 'react'
import { DropZone } from './components/DropZone'
import { MergeBar } from './components/MergeBar'
import { PdfCard, type PdfItem } from './components/PdfCard'
import { PdfPreviewModal } from './components/PdfPreviewModal'
import {
  heicBasenameToPdfName,
  heicToImage,
  imageToJpegPreview,
  pdfFromImage,
} from './lib/heicToPdf'
import { perspectiveCropImageBlob, type CropQuad } from './lib/cropImage'
import { mergePdfs, mergedPdfFilename } from './lib/mergePdfs'
import { downloadBlob } from './lib/pickFiles'
import { zipFilename, zipPdfs } from './lib/zipPdfs'
import { rotateImageBlob } from './lib/rotatePdf'
import './App.css'

const CONCURRENCY = 2
const COLUMN_OPTIONS = [1, 2, 3, 4, 6, 12] as const
type ColumnCount = (typeof COLUMN_OPTIONS)[number]

function createId(): string {
  return crypto.randomUUID()
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let done = 0

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index]!, index)
      done++
      onProgress?.(done, items.length)
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run())
  await Promise.all(runners)
  return results
}

export default function App() {
  const [items, setItems] = useState<PdfItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [converting, setConverting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [merging, setMerging] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [columns, setColumns] = useState<ColumnCount>(4)
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  const [croppingId, setCroppingId] = useState<string | null>(null)
  const [previewItem, setPreviewItem] = useState<PdfItem | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.imageUrl)
        URL.revokeObjectURL(item.previewUrl)
      }
    }
  }, [])

  const revokeItem = (item: PdfItem) => {
    URL.revokeObjectURL(item.imageUrl)
    URL.revokeObjectURL(item.previewUrl)
  }

  const busy = converting || merging || downloading || exporting

  const handleFiles = useCallback(async (files: File[]) => {
    setConverting(true)
    setErrors([])
    setProgress({ done: 0, total: files.length })

    const failed: string[] = []

    await mapPool(
      files,
      CONCURRENCY,
      async (file) => {
        try {
          const { image, preview } = await heicToImage(file)
          const item: PdfItem = {
            id: createId(),
            name: heicBasenameToPdfName(file.name),
            imageBlob: image,
            imageUrl: URL.createObjectURL(image),
            previewUrl: URL.createObjectURL(preview),
          }
          setItems((prev) => [...prev, item])
        } catch (err) {
          failed.push(
            `${file.name}: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
          )
          setErrors([...failed])
        }
      },
      (done, total) => setProgress({ done, total }),
    )

    setErrors(failed)
    setProgress(null)
    setConverting(false)
  }, [])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedInOrder = (): PdfItem[] => {
    const byId = new Map(items.map((item) => [item.id, item]))
    return [...selected]
      .map((id) => byId.get(id))
      .filter((item): item is PdfItem => item !== undefined)
  }

  const selectionOrder = (() => {
    const order = new Map<string, number>()
    let i = 1
    for (const id of selected) {
      order.set(id, i++)
    }
    return order
  })()

  const removeItems = (ids: Iterable<string>) => {
    const idSet = ids instanceof Set ? ids : new Set(ids)
    if (idSet.size === 0) return

    setPreviewItem((current) =>
      current && idSet.has(current.id) ? null : current,
    )
    setItems((prev) => {
      const keep: PdfItem[] = []
      for (const item of prev) {
        if (idSet.has(item.id)) revokeItem(item)
        else keep.push(item)
      }
      return keep
    })
    setSelected((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of idSet) {
        if (next.delete(id)) changed = true
      }
      return changed ? next : prev
    })
  }

  const removeItem = (id: string) => {
    removeItems([id])
  }

  const selectAll = () => {
    setSelected(new Set(items.map((item) => item.id)))
  }

  const clearSelection = () => {
    setSelected(new Set())
  }

  const replaceItemImages = (
    id: string,
    imageBlob: Blob,
    previewBlob: Blob,
  ): PdfItem | null => {
    const current = itemsRef.current.find((item) => item.id === id)
    if (!current) return null

    const updated: PdfItem = {
      ...current,
      imageBlob,
      imageUrl: URL.createObjectURL(imageBlob),
      previewUrl: URL.createObjectURL(previewBlob),
    }

    revokeItem(current)
    setItems((prev) => prev.map((item) => (item.id === id ? updated : item)))
    setPreviewItem((open) => (open?.id === id ? updated : open))
    return updated
  }

  const handleMerge = async () => {
    const ordered = selectedInOrder()
    if (ordered.length < 2) return

    setMerging(true)
    setExporting(true)
    try {
      const pdfs = await Promise.all(ordered.map((item) => pdfFromImage(item.imageBlob)))
      const blob = await mergePdfs(pdfs)
      const name = mergedPdfFilename()
      downloadBlob(blob, name)
      removeItems(ordered.map((item) => item.id))
    } catch (err) {
      setErrors([
        `Merge fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
      ])
    } finally {
      setMerging(false)
      setExporting(false)
    }
  }

  const handleDownloadSelected = async () => {
    const ordered = selectedInOrder()
    if (ordered.length === 0) return

    setDownloading(true)
    setExporting(true)
    try {
      if (ordered.length === 1) {
        const item = ordered[0]!
        const pdf = await pdfFromImage(item.imageBlob)
        downloadBlob(pdf, item.name)
      } else {
        const pdfs = await Promise.all(
          ordered.map(async (item) => ({
            name: item.name,
            blob: await pdfFromImage(item.imageBlob),
          })),
        )
        const zip = await zipPdfs(pdfs)
        downloadBlob(zip, zipFilename())
      }
      removeItems(ordered.map((item) => item.id))
    } catch (err) {
      setErrors([
        `Download fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
      ])
    } finally {
      setDownloading(false)
      setExporting(false)
    }
  }

  const handleDownloadOne = async (item: PdfItem) => {
    setExporting(true)
    try {
      const pdf = await pdfFromImage(item.imageBlob)
      downloadBlob(pdf, item.name)
      removeItem(item.id)
    } catch (err) {
      setErrors([
        `Download fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
      ])
    } finally {
      setExporting(false)
    }
  }

  const neighborAfterRemove = (id: string): PdfItem | null => {
    const list = itemsRef.current
    const idx = list.findIndex((entry) => entry.id === id)
    if (idx < 0) return null
    return list[idx + 1] ?? list[idx - 1] ?? null
  }

  const handleDownloadFromPreview = async (item: PdfItem) => {
    const fallback = neighborAfterRemove(item.id)
    await handleDownloadOne(item)
    setPreviewItem(fallback && fallback.id !== item.id ? fallback : null)
  }

  const handleRemoveFromPreview = (id: string) => {
    const fallback = neighborAfterRemove(id)
    removeItem(id)
    setPreviewItem(fallback && fallback.id !== id ? fallback : null)
  }

  const handleRotate = async (id: string) => {
    const current = itemsRef.current.find((item) => item.id === id)
    if (!current || rotatingId || croppingId) return

    setRotatingId(id)
    try {
      const rotated = await rotateImageBlob(current.imageBlob, 90)
      const preview = await imageToJpegPreview(rotated)
      replaceItemImages(id, rotated, preview)
    } catch (err) {
      setErrors([
        `Drehen fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
      ])
    } finally {
      setRotatingId(null)
    }
  }

  const handleCrop = async (id: string, quad: CropQuad): Promise<PdfItem | null> => {
    const current = itemsRef.current.find((item) => item.id === id)
    if (!current || croppingId || rotatingId) return null

    setCroppingId(id)
    try {
      const cropped = await perspectiveCropImageBlob(current.imageBlob, quad)
      const preview = await imageToJpegPreview(cropped)
      return replaceItemImages(id, cropped, preview)
    } catch (err) {
      setErrors([
        `Zuschneiden fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
      ])
      throw err
    } finally {
      setCroppingId(null)
    }
  }

  const handleCropAndDownload = async (id: string, quad: CropQuad) => {
    const updated = await handleCrop(id, quad)
    if (updated) {
      await handleDownloadFromPreview(updated)
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-row">
          <h1>HEIC → PDF Merger</h1>
          <p className="app__remaining" aria-live="polite">
            <strong>{items.length}</strong>
            {items.length === 1 ? ' Datei übrig' : ' Dateien übrig'}
          </p>
        </div>
        <p>100 % lokal — Dateien verlassen deinen Browser nicht.</p>
      </header>

      <DropZone disabled={busy} onFiles={handleFiles} />

      {progress && (
        <p className="status" role="status">
          Konvertiere {progress.done}/{progress.total}…
        </p>
      )}

      {exporting && !progress && (
        <p className="status" role="status">
          PDF wird erzeugt…
        </p>
      )}

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <>
          <div className="toolbar">
            <label className="toolbar__columns">
              <span>Pro Zeile</span>
              <select
                value={columns}
                disabled={busy}
                onChange={(e) => setColumns(Number(e.target.value) as ColumnCount)}
              >
                {COLUMN_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="toolbar__select-all"
              disabled={busy}
              onClick={
                selected.size === items.length ? clearSelection : selectAll
              }
            >
              {selected.size === items.length ? 'Auswahl aufheben' : 'Alles auswählen'}
            </button>
          </div>
          <section
            className="grid"
            aria-label="PDF-Karten"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {items.map((item) => (
              <PdfCard
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                selectionIndex={selectionOrder.get(item.id)}
                rotating={rotatingId === item.id}
                onToggle={toggle}
                onDownload={handleDownloadOne}
                onRemove={removeItem}
                onPreview={setPreviewItem}
                onRotate={handleRotate}
              />
            ))}
          </section>
        </>
      )}

      {!converting && items.length === 0 && (
        <p className="empty">Noch keine Dateien — starte mit HEIC-Dateien oben.</p>
      )}

      {previewItem && (
        <PdfPreviewModal
          item={previewItem}
          items={items}
          selected={selected.has(previewItem.id)}
          rotating={rotatingId === previewItem.id}
          croppingBusy={croppingId === previewItem.id}
          onClose={() => setPreviewItem(null)}
          onNavigate={setPreviewItem}
          onRotate={handleRotate}
          onToggle={toggle}
          onDownload={handleDownloadFromPreview}
          onRemove={handleRemoveFromPreview}
          onCrop={handleCrop}
          onCropAndDownload={handleCropAndDownload}
        />
      )}

      <MergeBar
        selectedCount={selected.size}
        merging={merging}
        downloading={downloading || exporting}
        onMerge={handleMerge}
        onDownloadSelected={handleDownloadSelected}
      />
    </div>
  )
}
