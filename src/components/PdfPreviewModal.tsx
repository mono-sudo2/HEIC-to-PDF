import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import type { PdfItem } from './PdfCard'

type PdfPreviewModalProps = {
  item: PdfItem
  onClose: () => void
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const ZOOM_STEP = 0.2

type ViewState = {
  zoom: number
  x: number
  y: number
}

export function PdfPreviewModal({ item, onClose }: PdfPreviewModalProps) {
  const [{ zoom, x, y }, setView] = useState<ViewState>({ zoom: 1, x: 0, y: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
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
  }, [onClose, resetView, zoomBy])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const direction = e.deltaY > 0 ? -1 : 1
    // Feinere Schritte bei Trackpad/Pixel-Scroll
    const amount =
      e.deltaMode === 0
        ? Math.min(0.35, Math.abs(e.deltaY) * 0.004) * direction
        : ZOOM_STEP * direction
    zoomBy(amount, { clientX: e.clientX, clientY: e.clientY })
  }

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

  return (
    <div className="preview-modal" role="dialog" aria-modal="true" aria-label={item.name}>
      <button type="button" className="preview-modal__backdrop" aria-label="Schließen" onClick={onClose} />
      <div className="preview-modal__panel">
        <header className="preview-modal__header">
          <p className="preview-modal__title" title={item.name}>
            {item.name}
          </p>
          <div className="preview-modal__controls">
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
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
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
          <p className="preview-modal__hint">Scrollen = Zoom · Ziehen = Bewegen</p>
        </div>
      </div>
    </div>
  )
}
