/** Save fetched attachment bytes through a temporary object URL. */

/** Offer a blob to the browser as a download.
 * @param blob - file bytes.
 * @param name - suggested file name.
 */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 60000)
}
