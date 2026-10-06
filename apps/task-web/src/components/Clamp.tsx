/** Fixed-height preview of tall content with an expand control. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'

/** Show at most `maxHeight` pixels of the content until the reader expands it.
 * @param props.maxHeight - collapsed height in px.
 * @param props.children - content whose natural height may exceed the limit.
 * @returns the content, with a fade and an expand button when it is taller than the limit.
 */
export function Clamp({ maxHeight, children }: { maxHeight: number; children: ReactNode }) {
  const t = useT()
  const body = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [tall, setTall] = useState(false)
  useLayoutEffect(() => {
    const node = body.current
    if (node === null) return
    const measure = () => { setTall(node.scrollHeight > maxHeight + 1) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [maxHeight])
  const clipped = tall && !open
  return (
    <div className="tw-clamp" data-clipped={clipped || undefined}>
      <div ref={body} className="tw-clamp-body" style={clipped ? { maxHeight } : undefined}>{children}</div>
      {tall && (
        <button type="button" className="tw-clamp-toggle" aria-expanded={open} data-open={open || undefined}
          onClick={() => { setOpen(value => !value) }}>
          <span>{open ? t.run.collapse : t.run.expand}</span><IconChevronDownOutlineRegular size={12} />
        </button>
      )}
    </div>
  )
}
