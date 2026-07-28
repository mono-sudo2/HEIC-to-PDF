import JSZip from 'jszip'

export async function zipPdfs(
  files: { name: string; blob: Blob }[],
): Promise<Blob> {
  const zip = new JSZip()
  const usedNames = new Map<string, number>()

  for (const file of files) {
    const uniqueName = uniqueFilename(file.name, usedNames)
    zip.file(uniqueName, file.blob)
  }

  return zip.generateAsync({ type: 'blob' })
}

function uniqueFilename(name: string, used: Map<string, number>): string {
  const count = used.get(name) ?? 0
  used.set(name, count + 1)
  if (count === 0) return name

  const dot = name.lastIndexOf('.')
  if (dot <= 0) return `${name} (${count})`
  return `${name.slice(0, dot)} (${count})${name.slice(dot)}`
}

export function zipFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `pdfs-${stamp}.zip`
}
