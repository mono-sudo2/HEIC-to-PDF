import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PdfItem } from './PdfCard'

type PdfPreviewModalProps = {
  item: PdfItem
  items: PdfItem[]
  selected: boolean
  rotating?: boolean
  onClose: () => void
  onNavigate: (item: PdfItem) => void
  onRotate: (id: string) => void
  onToggle: (id: string) => void
  onDownload: (item: PdfItem) => void
  onRemove: (id: string) => void
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const ZOOM_STEP = 0.2

type ViewState = {
  zoom: number
  x: number
  y: number
}

export function PdfPreviewModal({
  item,
  items,
  selected,
  rotating,
  onClose,
  onNavigate,
  onRotate,
  onToggle,
  onDownload,
  onRemove,
}: PdfPreviewModalProps) {
  const [{ zoom, x, y }, setView] = useState<ViewState>({ zoom: 1, x: 0, y: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const zoomByRef = useRef<(
    delta: number,
    origin?: { clientX: number; clientY: number },
  ) => void>(() => {})
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  const index = items.findIndex((entry) => entry.id === item.id)
  const hasPrev = index > 0
  const hasNext = index >= 0 && index < items.length - 1

  const goPrev = useCallback(() => {
    if (index <= 0) return
    const prev = items[index - 1]
    if (prev) onNavigate(prev)
  }, [index, items, onNavigate])

  const goNext = useCallback(() => {
    if (index < 0 || index >= items.length - 1) return
    const next = items[index + 1]
    if (next) onNavigate(next)
  }, [index, items, onNavigate])

  const clampZoom = (value: number) =>
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +value.toFixed(3)))

  const resetView = useCallback(() => {
    setView({ zoom: 1, x: 0, y: 0 })
  }, [])

  const zoomBy = useCallback((delta: number, origin?: { clientX: number; clientY: number }) => {
    setView((prev) => {
      const nextZoom = clampZoom(prev.zoom + delta)
      if (nextZoom === prev.zoom) return prev

      const stage = stageRef.current
      if (!stage || !origin) {
        return { ...prev, zoom: nextZoom }
      }

      const rect = stage.getBoundingClientRect()
      const cx = origin.clientX - rect.left - rect.width / 2
      const cy = origin.clientY - rect.top - rect.height / 2
      const ratio = nextZoom / prev.zoom

      return {
        zoom: nextZoom,
        x: cx - (cx - prev.x) * ratio,
        y: cy - (cy - prev.y) * ratio,
      }
    })
  }, [])

  zoomByRef.current = zoomBy

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        if (!rotating) onRotate(item.id)
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        onDownload(item)
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        onRemove(item.id)
      }
      if (e.key === ' ') {
        e.preventDefault()
        onToggle(item.id)
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomBy(ZOOM_STEP)
      }
      if (e.key === '-') {
        e.preventDefault()
        zoomBy(-ZOOM_STEP)
      }
      if (e.key === '0') resetView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    onClose,
    resetView,
    zoomBy,
    goPrev,
    goNext,
    onRotate,
    onDownload,
    onRemove,
    onToggle,
    item,
    rotating,
  ])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    const panel = panelRef.current
    if (!stage) return

    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const direction = e.deltaY > 0 ? -1 : 1
      const amount =
        e.ctrlKey || e.metaKey
          ? Math.min(0.5, Math.abs(e.deltaY) * 0.01) * direction
          : e.deltaMode === 0
            ? Math.min(0.35, Math.abs(e.deltaY) * 0.004) * direction
            : ZOOM_STEP * direction

      zoomByRef.current(amount, { clientX: e.clientX, clientY: e.clientY })
    }

    const blockGesture = (e: Event) => {
      e.preventDefault()
    }

    const onWindowWheel = (e: globalThis.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
      }
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('wheel', onWindowWheel, { passive: false })
    panel?.addEventListener('gesturestart', blockGesture, { passive: false })
    panel?.addEventListener('gesturechange', blockGesture, { passive: false })
    panel?.addEventListener('gestureend', blockGesture, { passive: false })

    return () => {
      stage.removeEventListener('wheel', onWheel)
      window.removeEventListener('wheel', onWindowWheel)
      panel?.removeEventListener('gesturestart', blockGesture)
      panel?.removeEventListener('gesturechange', blockGesture)
      panel?.removeEventListener('gestureend', blockGesture)
    }
  }, [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: x,
      originY: y,
    }
    setDragging(true)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    setView((prev) => ({
      ...prev,
      x: drag.originX + dx,
      y: drag.originY + dy,
    }))
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const src = item.previewUrl ?? item.url
  const isImage = Boolean(item.previewUrl)
  const positionLabel =
    index >= 0 ? `${index + 1} / ${items.length}` : `– / ${items.length}`

  return (
    <div className="preview-modal" role="dialog" aria-modal="true" aria-label={item.name}>
      <button type="button" className="preview-modal__backdrop" aria-label="Schließen" onClick={onClose} />
      <div className="preview-modal__panel" ref={panelRef}>
        <header className="preview-modal__header">
          <div className="preview-modal__heading">
            <label className="preview-modal__select">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(item.id)}
              />
              <span>Auswählen</span>
            </label>
            <p className="preview-modal__title" title={item.name}>
              {item.name}
            </p>
          </div>
          <div className="preview-modal__controls">
            <button
              type="button"
              onClick={goPrev}
              disabled={!hasPrev}
              aria-label="Vorheriges Dokument"
              title="← Vorheriges"
            >
              ←
            </button>
            <span className="preview-modal__position">{positionLabel}</span>
            <button
              type="button"
              onClick={goNext}
              disabled={!hasNext}
              aria-label="Nächstes Dokument"
              title="→ Nächstes"
            >
              →
            </button>
            <span className="preview-modal__sep" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onRotate(item.id)}
              disabled={rotating}
              aria-label="90° drehen"
              title="Drehen (R)"
            >
              {rotating ? '…' : '↻'}
            </button>
            <button
              type="button"
              className="preview-modal__action"
              onClick={() => onDownload(item)}
              title="Download (D)"
            >
              Download
            </button>
            <button
              type="button"
              className="preview-modal__action preview-modal__action--danger"
              onClick={() => onRemove(item.id)}
              title="Entfernen (Entf)"
            >
              Entfernen
            </button>
            <span className="preview-modal__sep" aria-hidden="true" />
            <button
              type="button"
              onClick={() => zoomBy(-ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Verkleinern"
            >
              −
            </button>
            <span className="preview-modal__zoom">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Vergrößern"
            >
              +
            </button>
            <button type="button" className="preview-modal__reset" onClick={resetView}>
              Reset
            </button>
            <button type="button" className="preview-modal__close" onClick={onClose} aria-label="Schließen">
              ×
            </button>
          </div>
        </header>
        <div
          ref={stageRef}
          className={`preview-modal__stage${dragging ? ' preview-modal__stage--dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <button
            type="button"
            className="preview-modal__nav preview-modal__nav--prev"
            onClick={goPrev}
            disabled={!hasPrev}
            aria-label="Vorheriges Dokument"
          >
            ←
          </button>
          <div
            className="preview-modal__content"
            style={{
              transform: `translate(${x}px, ${y}px) scale(${zoom})`,
            }}
          >
            {isImage ? (
              <img src={src} alt={item.name} draggable={false} />
            ) : (
              <iframe title={item.name} src={src} />
            )}
          </div>
          <button
            type="button"
            className="preview-modal__nav preview-modal__nav--next"
            onClick={goNext}
            disabled={!hasNext}
            aria-label="Nächstes Dokument"
          >
            →
          </button>
          <p className="preview-modal__hint">
            Leertaste = Auswahl · D = Download · Entf = Entfernen · R = Drehen
          </p>
        </div>
      </div>
    </div>
  )
}
