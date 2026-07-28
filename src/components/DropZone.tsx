import { useRef, useState, type DragEvent } from 'react'
import { canPickDirectory, filterHeicFiles, pickHeicFromDirectory } from '../lib/pickFiles'

type DropZoneProps = {
  disabled?: boolean
  onFiles: (files: File[]) => void
}

export function DropZone({ disabled, onFiles }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFiles = (list: FileList | File[]) => {
    setError(null)
    const heic = filterHeicFiles(list)
    if (heic.length === 0) {
      setError('Keine HEIC-Dateien gefunden.')
      return
    }
    onFiles(heic)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    if (e.dataTransfer.files?.length) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const onPickDirectory = async () => {
    setError(null)
    try {
      const files = await pickHeicFromDirectory()
      if (files.length === 0) {
        setError('Keine HEIC-Dateien im Ordner gefunden.')
        return
      }
      onFiles(files)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Ordner konnte nicht gelesen werden.')
    }
  }

  return (
    <section
      className={`dropzone${dragging ? ' dropzone--active' : ''}${disabled ? ' dropzone--disabled' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <p className="dropzone__title">HEIC-Dateien lokal laden</p>
      <p className="dropzone__hint">
        Ordner wählen, Dateien auswählen oder hierher ziehen — alles bleibt im Browser.
      </p>
      <div className="dropzone__actions">
        {canPickDirectory() && (
          <button type="button" disabled={disabled} onClick={onPickDirectory}>
            Ordner wählen
          </button>
        )}
        <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
          Dateien wählen
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".heic,.heif,image/heic,image/heif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {error && <p className="dropzone__error">{error}</p>}
    </section>
  )
}
