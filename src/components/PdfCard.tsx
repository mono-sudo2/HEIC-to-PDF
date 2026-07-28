export type PdfItem = {
  id: string
  name: string
  blob: Blob
  url: string
  previewUrl?: string
}

type PdfCardProps = {
  item: PdfItem
  selected: boolean
  onToggle: (id: string) => void
  onDownload: (item: PdfItem) => void
  onRemove: (id: string) => void
}

export function PdfCard({ item, selected, onToggle, onDownload, onRemove }: PdfCardProps) {
  return (
    <article className={`pdf-card${selected ? ' pdf-card--selected' : ''}`}>
      <label className="pdf-card__check">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(item.id)}
        />
        <span className="visually-hidden">Auswählen</span>
      </label>
      <button
        type="button"
        className="pdf-card__remove"
        title="Entfernen"
        aria-label={`${item.name} entfernen`}
        onClick={() => onRemove(item.id)}
      >
        ×
      </button>
      <div className="pdf-card__preview">
        {item.previewUrl ? (
          <img src={item.previewUrl} alt="" />
        ) : (
          <iframe title={item.name} src={item.url} />
        )}
      </div>
      <div className="pdf-card__meta">
        <p className="pdf-card__name" title={item.name}>
          {item.name}
        </p>
        <button type="button" className="pdf-card__download" onClick={() => onDownload(item)}>
          Download
        </button>
      </div>
    </article>
  )
}
