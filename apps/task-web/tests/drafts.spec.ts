// @vitest-environment jsdom
/** Reading files out of a paste or drop, and telling a copied file from copied text. */
import { describe, expect, it } from 'vitest'
import { carriedFiles, textNamesFiles, type FileCarrier } from '../src/support/drafts.ts'

const file = (name: string, type = 'text/plain') => new File(['x'], name, { type })

/** Clipboard data whose entries are files, folders or text lines, in order. */
function carrier(entries: readonly (File | 'folder' | 'text')[]): FileCarrier {
  const files = entries.filter((entry): entry is File => entry instanceof File)
  return {
    files,
    items: entries.map(entry => ({
      kind: entry === 'text' ? 'string' : 'file',
      getAsFile: () => (entry instanceof File ? entry : null),
      webkitGetAsEntry: () => (entry === 'folder' ? { isDirectory: true } : { isDirectory: false }),
    })),
  }
}

describe('files of a paste or drop', () => {
  it('are read in order and leave text entries out', () => {
    const png = file('shot.png', 'image/png')
    const log = file('run.log')
    expect(carriedFiles(carrier([png, 'text', log]))).toEqual({ files: [png, log], directories: 0 })
  })

  it('leave folders out and count them', () => {
    const log = file('run.log')
    expect(carriedFiles(carrier(['folder', log, 'folder']))).toEqual({ files: [log], directories: 2 })
  })

  it('fall back to the file list when the browser reports no file entries', () => {
    const log = file('run.log')
    expect(carriedFiles({ items: [], files: [log] })).toEqual({ files: [log], directories: 0 })
  })

  it('skip an entry whose file is unavailable', () => {
    const entry: FileCarrier = { files: [], items: [{ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => null }] }
    expect(carriedFiles(entry)).toEqual({ files: [], directories: 0 })
  })
})

describe('text that comes with pasted files', () => {
  const files = [file('shot.png'), file('run.log')]

  it('is dropped when it is empty or only names the files', () => {
    expect(textNamesFiles('', files)).toBe(true)
    expect(textNamesFiles('shot.png', files)).toBe(true)
    expect(textNamesFiles('shot.png\r\nrun.log\n', files)).toBe(true)
  })

  it('is kept when any line is other text', () => {
    expect(textNamesFiles('see shot.png', files)).toBe(false)
    expect(textNamesFiles('shot.png\nnotes', files)).toBe(false)
  })
})
