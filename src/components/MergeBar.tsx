type MergeBarProps = {
  selectedCount: number
  merging: boolean
  downloading: boolean
  onMerge: () => void
  onDownloadSelected: () => void
}

export function MergeBar({
  selectedCount,
  merging,
  downloading,
  onMerge,
  onDownloadSelected,
}: MergeBarProps) {
  if (selectedCount === 0) return null

  const busy = merging || downloading
  const downloadLabel =
    downloading
      ? 'ZIP wird erstellt…'
      : selectedCount > 1
        ? 'Als ZIP herunterladen'
        : 'Herunterladen'

  return (
    <div className="merge-bar">
      <span>
        {selectedCount} ausgewählt
      </span>
      <div className="merge-bar__actions">
        <button
          type="button"
          className="merge-bar__download"
          disabled={busy}
          onClick={onDownloadSelected}
        >
          {downloadLabel}
        </button>
        <button
          type="button"
          disabled={selectedCount < 2 || busy}
          onClick={onMerge}
        >
          {merging ? 'Wird zusammengeführt…' : 'Zusammenführen'}
        </button>
      </div>
    </div>
  )
}
