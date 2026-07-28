import { useCallback, useEffect, useRef, useState } from 'react'
import { DropZone } from './components/DropZone'
import { MergeBar } from './components/MergeBar'
import { PdfCard, type PdfItem } from './components/PdfCard'
import { PdfPreviewModal } from './components/PdfPreviewModal'
import { heicBasenameToPdfName, heicToPdf } from './lib/heicToPdf'
import { mergePdfs, mergedPdfFilename } from './lib/mergePdfs'
import { downloadBlob } from './lib/pickFiles'
import { zipFilename, zipPdfs } from './lib/zipPdfs'
import './App.css'

const CONCURRENCY = 2

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
  const [previewItem, setPreviewItem] = useState<PdfItem | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.url)
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      }
    }
  }, [])

  const revokeItem = (item: PdfItem) => {
    URL.revokeObjectURL(item.url)
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  }

  const handleFiles = useCallback(async (files: File[]) => {
    setConverting(true)
    setErrors([])
    setProgress({ done: 0, total: files.length })

    const failed: string[] = []

    const results = await mapPool(
      files,
      CONCURRENCY,
      async (file) => {
        try {
          const { pdf, preview } = await heicToPdf(file)
          return {
            ok: true as const,
            item: {
              id: createId(),
              name: heicBasenameToPdfName(file.name),
              blob: pdf,
              url: URL.createObjectURL(pdf),
              previewUrl: URL.createObjectURL(preview),
            },
          }
        } catch (err) {
          failed.push(
            `${file.name}: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
          )
          return { ok: false as const }
        }
      },
      (done, total) => setProgress({ done, total }),
    )

    const created = results.flatMap((r) => (r.ok ? [r.item] : []))
    setItems((prev) => [...prev, ...created])
    setErrors(failed)
    setProgress(null)
    setConverting(false)
  }, [])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id) // ans Ende → Klick-Reihenfolge
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
    // Sichtreihenfolge, falls nicht einzeln angeklickt
    setSelected(new Set(items.map((item) => item.id)))
  }

  const clearSelection = () => {
    setSelected(new Set())
  }

  const handleMerge = async () => {
    const ordered = selectedInOrder()
    if (ordered.length < 2) return

    setMerging(true)
    try {
      const blob = await mergePdfs(ordered.map((i) => i.blob))
      const name = mergedPdfFilename()
      const ids = ordered.map((item) => item.id)
      downloadBlob(blob, name)
      removeItems(ids)
    } catch (err) {
      setErrors([
        `Merge fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
      ])
    } finally {
      setMerging(false)
    }
  }

  const handleDownloadSelected = async () => {
    const ordered = selectedInOrder()
    if (ordered.length === 0) return

    setDownloading(true)
    try {
      if (ordered.length === 1) {
        const item = ordered[0]!
        downloadBlob(item.blob, item.name)
      } else {
        const zip = await zipPdfs(
          ordered.map((item) => ({ name: item.name, blob: item.blob })),
        )
        downloadBlob(zip, zipFilename())
      }
      removeItems(ordered.map((item) => item.id))
    } catch (err) {
      setErrors([
        `Download fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
      ])
    } finally {
      setDownloading(false)
    }
  }

  const handleDownloadOne = (item: PdfItem) => {
    downloadBlob(item.blob, item.name)
    removeItem(item.id)
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

      <DropZone disabled={converting || merging || downloading} onFiles={handleFiles} />

      {progress && (
        <p className="status" role="status">
          Konvertiere {progress.done}/{progress.total}…
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
            <button
              type="button"
              className="toolbar__select-all"
              disabled={merging || converting || downloading}
              onClick={
                selected.size === items.length ? clearSelection : selectAll
              }
            >
              {selected.size === items.length ? 'Auswahl aufheben' : 'Alles auswählen'}
            </button>
          </div>
          <section className="grid" aria-label="PDF-Karten">
            {items.map((item) => (
              <PdfCard
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                selectionIndex={selectionOrder.get(item.id)}
                onToggle={toggle}
                onDownload={handleDownloadOne}
                onRemove={removeItem}
                onPreview={setPreviewItem}
              />
            ))}
          </section>
        </>
      )}

      {!converting && items.length === 0 && (
        <p className="empty">Noch keine PDFs — starte mit HEIC-Dateien oben.</p>
      )}

      {previewItem && (
        <PdfPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}

      <MergeBar
        selectedCount={selected.size}
        merging={merging}
        downloading={downloading}
        onMerge={handleMerge}
        onDownloadSelected={handleDownloadSelected}
      />
    </div>
  )
}
