type MergeBarProps = {
  selectedCount: number
  merging: boolean
  onMerge: () => void
  onDownloadSelected: () => void
}

export function MergeBar({
  selectedCount,
  merging,
  onMerge,
  onDownloadSelected,
}: MergeBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="merge-bar">
      <span>
        {selectedCount} ausgewählt
      </span>
      <div className="merge-bar__actions">
        <button
          type="button"
          className="merge-bar__download"
          disabled={merging}
          onClick={onDownloadSelected}
        >
          Herunterladen
        </button>
        <button
          type="button"
          disabled={selectedCount < 2 || merging}
          onClick={onMerge}
        >
          {merging ? 'Wird zusammengeführt…' : 'Zusammenführen'}
        </button>
      </div>
    </div>
  )
}
