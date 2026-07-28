export function isHeicFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    file.type === 'image/heic' ||
    file.type === 'image/heif'
  )
}

export function filterHeicFiles(files: Iterable<File>): File[] {
  return Array.from(files).filter(isHeicFile)
}

type FileSystemDirectoryHandleLike = {
  values: () => AsyncIterable<
    | { kind: 'file'; getFile: () => Promise<File> }
    | { kind: 'directory' }
    | { kind: string }
  >
}

export function canPickDirectory(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickHeicFromDirectory(): Promise<File[]> {
  if (!canPickDirectory()) {
    throw new Error('Ordnerauswahl wird in diesem Browser nicht unterstützt.')
  }

  const picker = (
    window as unknown as {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandleLike>
    }
  ).showDirectoryPicker

  const handle = await picker()

  const files: File[] = []
  for await (const entry of handle.values()) {
    if (entry.kind === 'file' && 'getFile' in entry) {
      const file = await entry.getFile()
      if (isHeicFile(file)) {
        files.push(file)
      }
    }
  }

  return files
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
