import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import type { PdfItem } from './PdfCard'
import { clampCropRect, type CropRect } from '../lib/cropImage'

type PdfPreviewModalProps = {
  item: PdfItem
  items: PdfItem[]
  selected: boolean
  rotating?: boolean
  croppingBusy?: boolean
  onClose: () => void
  onNavigate: (item: PdfItem) => void
  onRotate: (id: string) => void
  onToggle: (id: string) => void
  onDownload: (item: PdfItem) => void
  onRemove: (id: string) => void
  onCrop: (id: string, rect: CropRect) => void | Promise<void>
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const ZOOM_STEP = 0.2

type ViewState = {
  zoom: number
  x: number
  y: number
}

type OverlayBox = { left: number; top: number; width: number; height: number }

type CropDrag =
  | { type: 'create'; startX: number; startY: number; pointerId: number }
  | { type: 'move'; pointerId: number; startClientX: number; startClientY: number; origin: CropRect }
  | {
      type: 'resize'
      pointerId: number
      handle: 'nw' | 'ne' | 'sw' | 'se'
      startClientX: number
      startClientY: number
      origin: CropRect
    }

export function PdfPreviewModal({
  item,
  items,
  selected,
  rotating,
  croppingBusy,
  onClose,
  onNavigate,
  onRotate,
  onToggle,
  onDownload,
  onRemove,
  onCrop,
}: PdfPreviewModalProps) {
  const [{ zoom, x, y }, setView] = useState<ViewState>({ zoom: 1, x: 0, y: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
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
  const cropDragRef = useRef<CropDrag | null>(null)
  const [dragging, setDragging] = useState(false)
  const [cropping, setCropping] = useState(false)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const [overlay, setOverlay] = useState<OverlayBox | null>(null)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })

  const index = items.findIndex((entry) => entry.id === item.id)
  const hasPrev = index > 0
  const hasNext = index >= 0 && index < items.length - 1
  const busy = Boolean(rotating || croppingBusy)

  const goPrev = useCallback(() => {
    if (cropping || index <= 0) return
    const prev = items[index - 1]
    if (prev) onNavigate(prev)
  }, [cropping, index, items, onNavigate])

  const goNext = useCallback(() => {
    if (cropping || index < 0 || index >= items.length - 1) return
    const next = items[index + 1]
    if (next) onNavigate(next)
  }, [cropping, index, items, onNavigate])

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

  const updateOverlay = useCallback(() => {
    const img = imgRef.current
    const stage = stageRef.current
    if (!img || !stage || !cropRect || naturalSize.w === 0) {
      setOverlay(null)
      return
    }
    const stageBox = stage.getBoundingClientRect()
    const imgBox = img.getBoundingClientRect()
    setOverlay({
      left: imgBox.left - stageBox.left + (cropRect.x / naturalSize.w) * imgBox.width,
      top: imgBox.top - stageBox.top + (cropRect.y / naturalSize.h) * imgBox.height,
      width: (cropRect.w / naturalSize.w) * imgBox.width,
      height: (cropRect.h / naturalSize.h) * imgBox.height,
    })
  }, [cropRect, naturalSize])

  useLayoutEffect(() => {
    updateOverlay()
  }, [updateOverlay, zoom, x, y, item.id, cropping])

  const clientToImage = useCallback(
    (clientX: number, clientY: number) => {
      const img = imgRef.current
      if (!img || naturalSize.w === 0) return { x: 0, y: 0 }
      const box = img.getBoundingClientRect()
      return {
        x: ((clientX - box.left) / box.width) * naturalSize.w,
        y: ((clientY - box.top) / box.height) * naturalSize.h,
      }
    },
    [naturalSize],
  )

  const startCrop = () => {
    const img = imgRef.current
    const w = img?.naturalWidth || naturalSize.w
    const h = img?.naturalHeight || naturalSize.h
    if (!w || !h) return
    setNaturalSize({ w, h })
    const insetX = w * 0.1
    const insetY = h * 0.1
    setCropRect(
      clampCropRect(
        { x: insetX, y: insetY, w: w - insetX * 2, h: h - insetY * 2 },
        w,
        h,
      ),
    )
    setCropping(true)
  }

  const cancelCrop = () => {
    setCropping(false)
    setCropRect(null)
    setOverlay(null)
    cropDragRef.current = null
  }

  const applyCrop = async () => {
    if (!cropRect || busy) return
    try {
      await onCrop(item.id, cropRect)
      cancelCrop()
    } catch {
      // Fehler wird in App angezeigt; Crop-Modus bleibt offen
    }
  }

  useEffect(() => {
    cancelCrop()
  }, [item.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cropping) {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancelCrop()
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          applyCrop()
        }
        return
      }
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
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        startCrop()
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
  })

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
      if (cropping) return

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
  }, [cropping])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return

    if (cropping) {
      e.currentTarget.setPointerCapture(e.pointerId)
      const pt = clientToImage(e.clientX, e.clientY)
      cropDragRef.current = {
        type: 'create',
        startX: pt.x,
        startY: pt.y,
        pointerId: e.pointerId,
      }
      setCropRect(
        clampCropRect({ x: pt.x, y: pt.y, w: 20, h: 20 }, naturalSize.w, naturalSize.h),
      )
      return
    }

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
    const cropDrag = cropDragRef.current
    if (cropping && cropDrag && cropDrag.pointerId === e.pointerId) {
      if (cropDrag.type === 'create') {
        const pt = clientToImage(e.clientX, e.clientY)
        const x0 = Math.min(cropDrag.startX, pt.x)
        const y0 = Math.min(cropDrag.startY, pt.y)
        const x1 = Math.max(cropDrag.startX, pt.x)
        const y1 = Math.max(cropDrag.startY, pt.y)
        setCropRect(
          clampCropRect(
            { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
            naturalSize.w,
            naturalSize.h,
          ),
        )
        return
      }
      if (cropDrag.type === 'move') {
        const img = imgRef.current
        if (!img) return
        const box = img.getBoundingClientRect()
        const dx = ((e.clientX - cropDrag.startClientX) / box.width) * naturalSize.w
        const dy = ((e.clientY - cropDrag.startClientY) / box.height) * naturalSize.h
        setCropRect(
          clampCropRect(
            {
              x: cropDrag.origin.x + dx,
              y: cropDrag.origin.y + dy,
              w: cropDrag.origin.w,
              h: cropDrag.origin.h,
            },
            naturalSize.w,
            naturalSize.h,
          ),
        )
        return
      }
      if (cropDrag.type === 'resize') {
        const img = imgRef.current
        if (!img) return
        const box = img.getBoundingClientRect()
        const dx = ((e.clientX - cropDrag.startClientX) / box.width) * naturalSize.w
        const dy = ((e.clientY - cropDrag.startClientY) / box.height) * naturalSize.h
        let { x: rx, y: ry, w: rw, h: rh } = cropDrag.origin
        if (cropDrag.handle.includes('e')) rw = cropDrag.origin.w + dx
        if (cropDrag.handle.includes('w')) {
          rx = cropDrag.origin.x + dx
          rw = cropDrag.origin.w - dx
        }
        if (cropDrag.handle.includes('s')) rh = cropDrag.origin.h + dy
        if (cropDrag.handle.includes('n')) {
          ry = cropDrag.origin.y + dy
          rh = cropDrag.origin.h - dy
        }
        setCropRect(clampCropRect({ x: rx, y: ry, w: rw, h: rh }, naturalSize.w, naturalSize.h))
        return
      }
    }

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
    if (cropDragRef.current?.pointerId === e.pointerId) {
      cropDragRef.current = null
    }
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const startMoveCrop = (e: PointerEvent<HTMLElement>) => {
    if (!cropRect) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    cropDragRef.current = {
      type: 'move',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origin: cropRect,
    }
  }

  const startResizeCrop = (
    handle: 'nw' | 'ne' | 'sw' | 'se',
    e: PointerEvent<HTMLElement>,
  ) => {
    if (!cropRect) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    cropDragRef.current = {
      type: 'resize',
      handle,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origin: cropRect,
    }
  }

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
            {!cropping ? (
              <>
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
                  disabled={busy}
                  aria-label="90° drehen"
                  title="Drehen (R)"
                >
                  {rotating ? '…' : '↻'}
                </button>
                <button
                  type="button"
                  className="preview-modal__action"
                  onClick={startCrop}
                  disabled={busy}
                  title="Zuschneiden (C)"
                >
                  Zuschneiden
                </button>
                <button
                  type="button"
                  className="preview-modal__action"
                  onClick={() => onDownload(item)}
                  disabled={busy}
                  title="Download (D)"
                >
                  Download
                </button>
                <button
                  type="button"
                  className="preview-modal__action preview-modal__action--danger"
                  onClick={() => onRemove(item.id)}
                  disabled={busy}
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
              </>
            ) : (
              <>
                <span className="preview-modal__position">Zuschneiden</span>
                <button
                  type="button"
                  className="preview-modal__action"
                  onClick={applyCrop}
                  disabled={busy || !cropRect}
                >
                  {croppingBusy ? '…' : 'Übernehmen'}
                </button>
                <button
                  type="button"
                  className="preview-modal__action"
                  onClick={cancelCrop}
                  disabled={croppingBusy}
                >
                  Abbrechen
                </button>
                <button type="button" className="preview-modal__close" onClick={onClose} aria-label="Schließen">
                  ×
                </button>
              </>
            )}
          </div>
        </header>
        <div
          ref={stageRef}
          className={`preview-modal__stage${dragging && !cropping ? ' preview-modal__stage--dragging' : ''}${cropping ? ' preview-modal__stage--cropping' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {!cropping && (
            <button
              type="button"
              className="preview-modal__nav preview-modal__nav--prev"
              onClick={goPrev}
              disabled={!hasPrev}
              aria-label="Vorheriges Dokument"
            >
              ←
            </button>
          )}
          <div
            className="preview-modal__content"
            style={{
              transform: `translate(${x}px, ${y}px) scale(${zoom})`,
            }}
          >
            <img
              ref={imgRef}
              src={item.imageUrl}
              alt={item.name}
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
              }}
            />
          </div>
          {cropping && overlay && (
            <div
              className="crop-overlay"
              style={{
                left: overlay.left,
                top: overlay.top,
                width: overlay.width,
                height: overlay.height,
              }}
              onPointerDown={startMoveCrop}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                <span
                  key={handle}
                  className={`crop-overlay__handle crop-overlay__handle--${handle}`}
                  onPointerDown={(e) => startResizeCrop(handle, e)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              ))}
            </div>
          )}
          {!cropping && (
            <button
              type="button"
              className="preview-modal__nav preview-modal__nav--next"
              onClick={goNext}
              disabled={!hasNext}
              aria-label="Nächstes Dokument"
            >
              →
            </button>
          )}
          <p className="preview-modal__hint">
            {cropping
              ? 'Rechteck ziehen · Ecken anpassen · Enter = Übernehmen · Esc = Abbrechen'
              : 'C = Zuschneiden · R = Drehen · Leertaste = Auswahl · D = Download'}
          </p>
        </div>
      </div>
    </div>
  )
}
