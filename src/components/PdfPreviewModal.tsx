import { useEffect, useState } from 'react'
import type { PdfItem } from './PdfCard'

type PdfPreviewModalProps = {
  item: PdfItem
  onClose: () => void
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25

export function PdfPreviewModal({ item, onClose }: PdfPreviewModalProps) {
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
      }
      if (e.key === '-') {
        e.preventDefault()
        setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
      }
      if (e.key === '0') setZoom(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))

  return (
    <div className="preview-modal" role="dialog" aria-modal="true" aria-label={item.name}>
      <button type="button" className="preview-modal__backdrop" aria-label="Schließen" onClick={onClose} />
      <div className="preview-modal__panel">
        <header className="preview-modal__header">
          <p className="preview-modal__title" title={item.name}>
            {item.name}
          </p>
          <div className="preview-modal__controls">
            <button type="button" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} aria-label="Verkleinern">
              −
            </button>
            <span className="preview-modal__zoom">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} aria-label="Vergrößern">
              +
            </button>
            <button type="button" className="preview-modal__reset" onClick={() => setZoom(1)}>
              Reset
            </button>
            <button type="button" className="preview-modal__close" onClick={onClose} aria-label="Schließen">
              ×
            </button>
          </div>
        </header>
        <div
          className="preview-modal__stage"
          onWheel={(e) => {
            if (!e.ctrlKey && !e.metaKey) return
            e.preventDefault()
            const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
            setZoom((z) =>
              Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z + delta).toFixed(2))),
            )
          }}
        >
          <div className="preview-modal__scaled" style={{ transform: `scale(${zoom})` }}>
            {item.previewUrl ? (
              <img src={item.previewUrl} alt={item.name} />
            ) : (
              <iframe title={item.name} src={item.url} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
