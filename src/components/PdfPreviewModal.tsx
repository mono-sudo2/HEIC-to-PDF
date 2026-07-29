import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import type { PdfItem } from './PdfCard'
import {
  clampCropQuad,
  defaultCropQuad,
  denormalizeQuad,
  normalizeQuad,
  type CropQuad,
  type NormalizedQuad,
  type Point,
} from '../lib/cropImage'

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
  onCrop: (id: string, quad: CropQuad) => void | Promise<void>
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const ZOOM_STEP = 0.2

type ViewState = { zoom: number; x: number; y: number }
type CornerKey = keyof CropQuad
type CornerScreen = Record<CornerKey, Point>

const CORNERS: CornerKey[] = ['tl', 'tr', 'br', 'bl']
const CORNER_LABELS: Record<CornerKey, string> = {
  tl: 'OL',
  tr: 'OR',
  br: 'UR',
  bl: 'UL',
}

/** Persistiert letzte Crop-Position (relativ) über Dokumente hinweg */
let savedNormQuad: NormalizedQuad | null = null

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
  const cornerDragRef = useRef<{
    key: CornerKey
    pointerId: number
    origin: Point
    startClientX: number
    startClientY: number
    imgWidth: number
    imgHeight: number
    naturalW: number
    naturalH: number
  } | null>(null)
  const naturalSizeRef = useRef({ w: 0, h: 0 })
  const croppingRef = useRef(false)

  const [dragging, setDragging] = useState(false)
  const [cropping, setCropping] = useState(false)
  const [quad, setQuad] = useState<CropQuad | null>(null)
  const [cornerScreen, setCornerScreen] = useState<CornerScreen | null>(null)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })

  croppingRef.current = cropping
  naturalSizeRef.current = naturalSize

  const index = items.findIndex((entry) => entry.id === item.id)
  const hasPrev = index > 0
  const hasNext = index >= 0 && index < items.length - 1
  const busy = Boolean(rotating || croppingBusy)

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
    if (croppingRef.current) return
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

  const persistQuad = useCallback((q: CropQuad, w: number, h: number) => {
    if (w > 0 && h > 0) {
      savedNormQuad = normalizeQuad(q, w, h)
    }
  }, [])

  const quadForSize = useCallback((w: number, h: number): CropQuad => {
    if (savedNormQuad) return denormalizeQuad(savedNormQuad, w, h)
    return defaultCropQuad(w, h)
  }, [])

  const updateCornerScreen = useCallback(() => {
    const img = imgRef.current
    const stage = stageRef.current
    if (!img || !stage || !quad || naturalSize.w === 0) {
      setCornerScreen(null)
      return
    }
    const stageBox = stage.getBoundingClientRect()
    const imgBox = img.getBoundingClientRect()
    if (imgBox.width < 1 || imgBox.height < 1) {
      setCornerScreen(null)
      return
    }
    const map = (p: Point): Point => ({
      x: imgBox.left - stageBox.left + (p.x / naturalSize.w) * imgBox.width,
      y: imgBox.top - stageBox.top + (p.y / naturalSize.h) * imgBox.height,
    })
    setCornerScreen({
      tl: map(quad.tl),
      tr: map(quad.tr),
      br: map(quad.br),
      bl: map(quad.bl),
    })
  }, [quad, naturalSize])

  useLayoutEffect(() => {
    updateCornerScreen()
  }, [updateCornerScreen, zoom, x, y, item.id, cropping])

  const startCrop = () => {
    const img = imgRef.current
    const w = img?.naturalWidth || naturalSize.w
    const h = img?.naturalHeight || naturalSize.h
    if (!w || !h) return
    setNaturalSize({ w, h })
    const next = quadForSize(w, h)
    setQuad(next)
    persistQuad(next, w, h)
    setCropping(true)
  }

  const cancelCrop = () => {
    setCropping(false)
    setQuad(null)
    setCornerScreen(null)
    cornerDragRef.current = null
  }

  const applyCrop = async () => {
    if (!quad || busy) return
    const { w, h } = naturalSizeRef.current
    persistQuad(quad, w, h)
    try {
      await onCrop(item.id, quad)
    } catch {
      // Fehler in App
    }
  }

  // Beim Dokumentwechsel: relative Crop-Position übernehmen, Modus behalten
  useEffect(() => {
    const applySize = (w: number, h: number) => {
      setNaturalSize({ w, h })
      if (croppingRef.current) {
        setQuad(quadForSize(w, h))
      }
    }

    const img = imgRef.current
    if (img?.naturalWidth) {
      applySize(img.naturalWidth, img.naturalHeight)
      return
    }

    const onLoad = () => {
      if (imgRef.current) {
        applySize(imgRef.current.naturalWidth, imgRef.current.naturalHeight)
      }
    }
    img?.addEventListener('load', onLoad)
    return () => img?.removeEventListener('load', onLoad)
  }, [item.id, quadForSize])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (croppingRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancelCrop()
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          void applyCrop()
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          goPrev()
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          goNext()
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
      if (croppingRef.current) return

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
      if (e.ctrlKey || e.metaKey) e.preventDefault()
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

  // Corner-Drag über window — Maus folgt stabil, unabhängig vom Handle-DOM
  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const drag = cornerDragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return

      const dx = ((e.clientX - drag.startClientX) / drag.imgWidth) * drag.naturalW
      const dy = ((e.clientY - drag.startClientY) / drag.imgHeight) * drag.naturalH

      setQuad((prev) => {
        if (!prev) return prev
        const next = clampCropQuad(
          {
            ...prev,
            [drag.key]: {
              x: drag.origin.x + dx,
              y: drag.origin.y + dy,
            },
          },
          drag.naturalW,
          drag.naturalH,
        )
        persistQuad(next, drag.naturalW, drag.naturalH)
        return next
      })
    }

    const onUp = (e: globalThis.PointerEvent) => {
      if (cornerDragRef.current?.pointerId === e.pointerId) {
        cornerDragRef.current = null
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [persistQuad])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || cropping) return
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

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    setView((prev) => ({
      ...prev,
      x: drag.originX + (e.clientX - drag.startX),
      y: drag.originY + (e.clientY - drag.startY),
    }))
  }

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const startCornerDrag = (key: CornerKey, e: PointerEvent<HTMLElement>) => {
    e.stopPropagation()
    e.preventDefault()
    if (!quad) return

    const img = imgRef.current
    if (!img || naturalSize.w === 0) return
    const imgBox = img.getBoundingClientRect()
    if (imgBox.width < 1 || imgBox.height < 1) return

    cornerDragRef.current = {
      key,
      pointerId: e.pointerId,
      origin: { ...quad[key] },
      startClientX: e.clientX,
      startClientY: e.clientY,
      imgWidth: imgBox.width,
      imgHeight: imgBox.height,
      naturalW: naturalSize.w,
      naturalH: naturalSize.h,
    }
  }

  const positionLabel =
    index >= 0 ? `${index + 1} / ${items.length}` : `– / ${items.length}`

  const polygonPoints = cornerScreen
    ? CORNERS.map((k) => `${cornerScreen[k].x},${cornerScreen[k].y}`).join(' ')
    : ''

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
                <button type="button" onClick={goPrev} disabled={!hasPrev} aria-label="Vorheriges" title="←">
                  ←
                </button>
                <span className="preview-modal__position">{positionLabel}</span>
                <button type="button" onClick={goNext} disabled={!hasNext} aria-label="Nächstes" title="→">
                  →
                </button>
                <span className="preview-modal__sep" aria-hidden="true" />
                <button type="button" onClick={() => onRotate(item.id)} disabled={busy} title="Drehen (R)">
                  {rotating ? '…' : '↻'}
                </button>
                <button
                  type="button"
                  className="preview-modal__action"
                  onClick={startCrop}
                  disabled={busy}
                  title="Perspektivisch zuschneiden (C)"
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
                  title="Entfernen"
                >
                  Entfernen
                </button>
                <span className="preview-modal__sep" aria-hidden="true" />
                <button type="button" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>
                  −
                </button>
                <span className="preview-modal__zoom">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>
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
                <button type="button" onClick={goPrev} disabled={!hasPrev} aria-label="Vorheriges" title="←">
                  ←
                </button>
                <span className="preview-modal__position">4 Ecken · {positionLabel}</span>
                <button type="button" onClick={goNext} disabled={!hasNext} aria-label="Nächstes" title="→">
                  →
                </button>
                <span className="preview-modal__sep" aria-hidden="true" />
                <button
                  type="button"
                  className="preview-modal__action"
                  onClick={() => void applyCrop()}
                  disabled={busy || !quad}
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
          <button
            type="button"
            className="preview-modal__nav preview-modal__nav--prev"
            onClick={goPrev}
            disabled={!hasPrev}
          >
            ←
          </button>
          <div
            className="preview-modal__content"
            style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}
          >
            <img
              ref={imgRef}
              src={item.imageUrl}
              alt={item.name}
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget
                const w = img.naturalWidth
                const h = img.naturalHeight
                setNaturalSize({ w, h })
                if (croppingRef.current) {
                  setQuad(quadForSize(w, h))
                }
              }}
            />
          </div>
          {cropping && cornerScreen && (
            <svg className="crop-quad" aria-hidden="true">
              <defs>
                <mask id={`crop-hole-${item.id}`}>
                  <rect x="0" y="0" width="100%" height="100%" fill="white" />
                  <polygon points={polygonPoints} fill="black" />
                </mask>
              </defs>
              <rect
                className="crop-quad__dim"
                x="0"
                y="0"
                width="100%"
                height="100%"
                mask={`url(#crop-hole-${item.id})`}
              />
              <polygon className="crop-quad__poly" points={polygonPoints} />
            </svg>
          )}
          {cropping &&
            cornerScreen &&
            CORNERS.map((key) => (
              <button
                key={key}
                type="button"
                className={`crop-quad__handle crop-quad__handle--${key}`}
                style={{
                  left: cornerScreen[key].x,
                  top: cornerScreen[key].y,
                }}
                aria-label={`Ecke ${CORNER_LABELS[key]}`}
                onPointerDown={(ev) => startCornerDrag(key, ev)}
              />
            ))}
          <button
            type="button"
            className="preview-modal__nav preview-modal__nav--next"
            onClick={goNext}
            disabled={!hasNext}
          >
            →
          </button>
          <p className="preview-modal__hint">
            {cropping
              ? 'Ecken ziehen · ← → nächstes Bild (Crop bleibt) · Enter = Übernehmen'
              : 'C = Zuschneiden · R = Drehen · Leertaste = Auswahl'}
          </p>
        </div>
      </div>
    </div>
  )
}
