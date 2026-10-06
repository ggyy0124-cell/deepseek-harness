// @vitest-environment jsdom
/** Run sidebar layout: the stored open choice and width, and the push or cover mode that follows the viewport. */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clampSidebarWidth, SIDEBAR_WIDTH, sidebarLayout, updateSidebarLayout, useRunSidebar } from '../src/support/sidebar.ts'

const KEY = 'dsh-task-web.run-sidebar'

/** Stub `matchMedia` with a viewport that the test can resize. */
function viewport(wide: boolean) {
  const listeners = new Set<() => void>()
  let matches = wide
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() { return matches },
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener) },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener) },
  }))
  return { set(next: boolean) { matches = next; listeners.forEach((listener) => { listener() }) } }
}

beforeEach(() => {
  localStorage.clear()
  updateSidebarLayout({ open: undefined, width: SIDEBAR_WIDTH.initial })
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

describe('width', () => {
  it('keeps a width whole and inside the limits', () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_WIDTH.min)
    expect(clampSidebarWidth(900)).toBe(SIDEBAR_WIDTH.max)
    expect(clampSidebarWidth(300.4)).toBe(300)
  })
})

describe('layout', () => {
  it('opens on wide screens until the reader collapses it, and remembers that choice and the width', () => {
    viewport(true)
    const { result } = renderHook(() => useRunSidebar())
    expect(result.current).toMatchObject({ open: true, covering: false, width: SIDEBAR_WIDTH.initial })
    act(() => { result.current.setOpen(false) })
    act(() => { result.current.setWidth(1000) })
    expect(result.current).toMatchObject({ open: false, width: SIDEBAR_WIDTH.max })
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({ open: false, width: SIDEBAR_WIDTH.max })
  })

  it('covers the page on narrow screens, starts closed and does not store the open state', () => {
    viewport(false)
    const { result } = renderHook(() => useRunSidebar())
    expect(result.current).toMatchObject({ open: false, covering: true })
    act(() => { result.current.setOpen(true) })
    expect(result.current.open).toBe(true)
    expect(sidebarLayout.get().open).toBeUndefined()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('switches between pushing and covering when the viewport crosses the threshold', () => {
    const screen = viewport(true)
    const { result } = renderHook(() => useRunSidebar())
    expect(result.current).toMatchObject({ covering: false, open: true })
    act(() => { screen.set(false) })
    expect(result.current).toMatchObject({ covering: true, open: false })
    act(() => { screen.set(true) })
    expect(result.current).toMatchObject({ covering: false, open: true })
  })

  it('keeps the layout for this page when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    updateSidebarLayout({ width: 400 })
    expect(sidebarLayout.get().width).toBe(400)
  })
})

describe('stored layout', () => {
  const load = async () => (await import('../src/support/sidebar.ts')).sidebarLayout.get()

  it('reads a stored choice and clamps a stored width', async () => {
    localStorage.setItem(KEY, JSON.stringify({ open: false, width: 9000 }))
    expect(await load()).toEqual({ open: false, width: SIDEBAR_WIDTH.max })
  })

  it('falls back to the defaults for missing, mistyped, unparsable or unreadable values', async () => {
    const fallback = { open: undefined, width: SIDEBAR_WIDTH.initial }
    expect(await load()).toEqual(fallback)
    localStorage.setItem(KEY, JSON.stringify({ open: 'yes', width: 'wide' }))
    vi.resetModules()
    expect(await load()).toEqual(fallback)
    localStorage.setItem(KEY, '{not json')
    vi.resetModules()
    expect(await load()).toEqual(fallback)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage denied') })
    vi.resetModules()
    expect(await load()).toEqual(fallback)
  })
})
