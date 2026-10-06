// @vitest-environment jsdom
/** Right sidebar shell: tab strip, collapse control, resize handle and covering presentation. */
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar, SidebarToggle, type SidebarTab } from '../src/components/Sidebar.tsx'
import { updatePreferences } from '../src/support/preferences.ts'
import { SIDEBAR_WIDTH } from '../src/support/sidebar.ts'

type Id = 'status' | 'record'

const tabs: readonly SidebarTab<Id>[] = [{ id: 'status', label: '状态' }, { id: 'record', label: '事件详情', closeLabel: '关闭事件详情' }]

/** jsdom implements neither pointer capture nor the PointerEvent constructor that carries coordinates and a pointer id. */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, { bubbles: true, cancelable: true, ...init })
    this.pointerId = init.pointerId ?? 1
  }
}
const capture = vi.fn()
const pointer = (type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', init: PointerEventInit = {}) => {
  act(() => { handle().dispatchEvent(new TestPointerEvent(type, init)) })
}

beforeEach(() => {
  updatePreferences({ locale: 'zh-CN' })
  capture.mockClear()
  HTMLElement.prototype.setPointerCapture = capture
})
afterEach(() => { cleanup(); Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture') })

function mount(patch: { open?: boolean; covering?: boolean; width?: number; active?: Id; scrollKey?: string } = {}) {
  const spies = { onSelect: vi.fn(), onCloseTab: vi.fn(), onCollapse: vi.fn(), onResize: vi.fn() }
  const element = (scrollKey: string) => (
    <Sidebar<Id> open={patch.open ?? true} covering={patch.covering ?? false} width={patch.width ?? SIDEBAR_WIDTH.initial} tabs={tabs}
      active={patch.active ?? 'status'} scrollKey={scrollKey} {...spies}>
      <p>sidebar body</p>
    </Sidebar>
  )
  const view = render(element(patch.scrollKey ?? 'a'))
  const track = () => view.container.querySelector<HTMLElement>('.tw-rightbar')
  return { ...view, spies, track, rerenderWith: (scrollKey: string) => { view.rerender(element(scrollKey)) } }
}
const handle = () => screen.getByRole('separator', { name: '调整侧边栏宽度' })

describe('tabs', () => {
  it('marks the active tab, reports a chosen tab and shows the body in a tab panel labelled by it', () => {
    const { spies } = mount()
    expect(screen.getByRole('tab', { name: '状态' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '事件详情' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel', { name: '状态' }).textContent).toBe('sidebar body')
    fireEvent.click(screen.getByRole('tab', { name: '事件详情' }))
    expect(spies.onSelect).toHaveBeenCalledWith('record')
  })

  it('moves between tabs with the arrow keys, wrapping at both ends, and focuses the chosen tab', () => {
    const { spies } = mount()
    const strip = screen.getByRole('tablist')
    fireEvent.keyDown(strip, { key: 'ArrowRight' })
    expect(spies.onSelect).toHaveBeenLastCalledWith('record')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '事件详情' }))
    fireEvent.keyDown(strip, { key: 'ArrowLeft' })
    expect(spies.onSelect).toHaveBeenLastCalledWith('record')
    fireEvent.keyDown(strip, { key: 'Home' })
    expect(spies.onSelect).toHaveBeenCalledTimes(2)
  })

  it('leaves only the active tab in the tab order', () => {
    mount({ active: 'record' })
    expect(screen.getByRole('tab', { name: '状态' }).tabIndex).toBe(-1)
    expect(screen.getByRole('tab', { name: '事件详情' }).tabIndex).toBe(0)
  })

  it('closes a tab through its own control and gives the other tab none', () => {
    const { spies } = mount()
    fireEvent.click(screen.getByRole('button', { name: '关闭事件详情' }))
    expect(spies.onCloseTab).toHaveBeenCalledWith('record')
    expect(screen.getAllByRole('button', { name: /关闭/ })).toHaveLength(1)
  })

  it('hands the active tab button to the caller for focus management', () => {
    const activeRef = createRef<HTMLButtonElement>()
    render(<Sidebar<Id> open covering={false} width={340} tabs={tabs} active="record" activeRef={activeRef} scrollKey="a" onSelect={vi.fn()}
      onCloseTab={vi.fn()} onCollapse={vi.fn()} onResize={vi.fn()}>body</Sidebar>)
    expect(activeRef.current).toBe(screen.getByRole('tab', { name: '事件详情' }))
  })
})

describe('presentation', () => {
  it('reports its open and covering state on the track and its width as a CSS variable', () => {
    const { track } = mount({ open: false, covering: true, width: 420 })
    expect(track()?.hasAttribute('data-open')).toBe(false)
    expect(track()?.hasAttribute('data-covering')).toBe(true)
    expect(track()?.style.getPropertyValue('--tw-rightbar-width')).toBe('420px')
  })

  it('collapses from the strip control', () => {
    const { spies } = mount()
    fireEvent.click(screen.getByRole('button', { name: '收起右侧边栏' }))
    expect(spies.onCollapse).toHaveBeenCalledTimes(1)
  })

  it('collapses on Escape only while it covers the page', () => {
    const covering = mount({ covering: true })
    fireEvent.keyDown(screen.getByRole('tab', { name: '状态' }), { key: 'Escape' })
    expect(covering.spies.onCollapse).toHaveBeenCalledTimes(1)
    cleanup()
    const pushing = mount({ covering: false })
    fireEvent.keyDown(screen.getByRole('tab', { name: '状态' }), { key: 'Escape' })
    expect(pushing.spies.onCollapse).not.toHaveBeenCalled()
  })

  it('scrolls the body back to its top when the scroll key or the tab changes', () => {
    const { rerenderWith } = mount()
    const body = screen.getByRole('tabpanel')
    body.scrollTop = 80
    rerenderWith('a')
    expect(body.scrollTop).toBe(80)
    rerenderWith('b')
    expect(body.scrollTop).toBe(0)
  })

  it('labels the open control with the mirrored sidebar glyph and returns its button', () => {
    const buttonRef = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const { container } = render(<SidebarToggle label="打开右侧边栏" onClick={onClick} buttonRef={buttonRef} />)
    fireEvent.click(screen.getByRole('button', { name: '打开右侧边栏' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(buttonRef.current).toBe(screen.getByRole('button', { name: '打开右侧边栏' }))
    expect(container.querySelector('svg.tw-mirror')).not.toBeNull()
    cleanup()
    render(<SidebarToggle label="收起" onClick={onClick} />)
    expect(screen.getByRole('button', { name: '收起' })).toBeDefined()
  })
})

describe('resize handle', () => {
  it('exposes the width limits and the current width', () => {
    mount({ width: 400 })
    expect(handle().getAttribute('aria-valuenow')).toBe('400')
    expect(handle().getAttribute('aria-valuemin')).toBe(String(SIDEBAR_WIDTH.min))
    expect(handle().getAttribute('aria-valuemax')).toBe(String(SIDEBAR_WIDTH.max))
  })

  it('grows with the left arrow, shrinks with the right arrow, stays inside the limits and ignores other keys', () => {
    const { spies } = mount({ width: 340 })
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(spies.onResize).toHaveBeenLastCalledWith(356)
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(spies.onResize).toHaveBeenLastCalledWith(324)
    fireEvent.keyDown(handle(), { key: 'a' })
    expect(spies.onResize).toHaveBeenCalledTimes(2)
    cleanup()
    const widest = mount({ width: SIDEBAR_WIDTH.max })
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(widest.spies.onResize).toHaveBeenLastCalledWith(SIDEBAR_WIDTH.max)
  })

  it('returns to the starting width on double click', () => {
    const { spies } = mount({ width: 500 })
    fireEvent.doubleClick(handle())
    expect(spies.onResize).toHaveBeenCalledWith(SIDEBAR_WIDTH.initial)
  })

  it('follows a drag to the left as a live width and commits it when the pointer is released', () => {
    const { spies, track } = mount({ width: 340 })
    pointer('pointermove', { clientX: 700 })
    expect(spies.onResize).not.toHaveBeenCalled()
    pointer('pointerdown', { clientX: 800, pointerId: 3 })
    expect(capture).toHaveBeenCalledWith(3)
    pointer('pointermove', { clientX: 750 })
    expect(track()?.style.getPropertyValue('--tw-rightbar-width')).toBe('390px')
    expect(track()?.hasAttribute('data-resizing')).toBe(true)
    pointer('pointermove', { clientX: 100 })
    expect(track()?.style.getPropertyValue('--tw-rightbar-width')).toBe(`${SIDEBAR_WIDTH.max}px`)
    pointer('pointerup')
    expect(spies.onResize).toHaveBeenCalledWith(SIDEBAR_WIDTH.max)
    expect(track()?.hasAttribute('data-resizing')).toBe(false)
    expect(track()?.style.getPropertyValue('--tw-rightbar-width')).toBe('340px')
  })

  it('commits the width reached when the pointer is cancelled and ignores a release without a drag', () => {
    const { spies } = mount({ width: 340 })
    pointer('pointerup')
    expect(spies.onResize).not.toHaveBeenCalled()
    pointer('pointerdown', { clientX: 500 })
    pointer('pointermove', { clientX: 520 })
    pointer('pointercancel')
    expect(spies.onResize).toHaveBeenCalledWith(320)
  })
})
