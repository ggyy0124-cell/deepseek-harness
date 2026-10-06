/** Scroll follow behavior of the conversation column. */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** Distance from the end within which the reader still counts as following new content. */
const FOLLOW_PX = 48

/** Keep a scroll container at its end while its reader has not scrolled away.
 * @param container - scroll container.
 * @param content - value that changes whenever content is appended or replaced; changes while `enabled` is false are ignored.
 * @param enabled - follow the end; when false the container returns to its start, and enabling it again follows from the end.
 */
export function useStickToBottom(container: RefObject<HTMLElement | null>, content: unknown, enabled: boolean): void {
  const following = useRef(true)
  const wasEnabled = useRef(enabled)
  useEffect(() => {
    const node = container.current
    if (node === null) return
    const track = () => { following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_PX }
    node.addEventListener('scroll', track, { passive: true })
    return () => { node.removeEventListener('scroll', track) }
  }, [container])
  const change = enabled ? content : undefined
  useLayoutEffect(() => {
    const node = container.current
    if (node === null) return
    if (!enabled) {
      wasEnabled.current = false
      node.scrollTop = 0
      return
    }
    if (!wasEnabled.current) {
      wasEnabled.current = true
      following.current = true
    }
    if (following.current) node.scrollTop = node.scrollHeight
  }, [container, enabled, change])
}
