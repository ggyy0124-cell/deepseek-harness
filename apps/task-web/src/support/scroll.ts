/** Scroll follow behavior of the Run page's scroll area. */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** Distance from the end within which the reader still counts as following new content. */
const FOLLOW_PX = 48

/** Keep a scroll container at its end while its reader has not scrolled away.
 * @param container - scroll container.
 * @param content - value that changes whenever content is appended or replaced; changes while `feed` is null are ignored.
 * @param feed - identity of the content the container shows, or null when it shows none: the container returns to its start.
 * A different identity, or leaving and re-entering null, follows from the end again.
 */
export function useStickToBottom(container: RefObject<HTMLElement | null>, content: unknown, feed: string | null): void {
  const following = useRef(true)
  const followed = useRef(feed)
  const placed = useRef<number | null>(null)
  useEffect(() => {
    const node = container.current
    if (node === null) return
    const track = () => {
      // The event of a scroll made here arrives after the next layout, which may have resized the container or grown its content.
      if (node.scrollTop === placed.current) return
      placed.current = null
      following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_PX
    }
    node.addEventListener('scroll', track, { passive: true })
    return () => { node.removeEventListener('scroll', track) }
  }, [container])
  const change = feed === null ? undefined : content
  useLayoutEffect(() => {
    const node = container.current
    if (node === null) return
    const place = (top: number) => {
      node.scrollTop = top
      placed.current = node.scrollTop
    }
    if (feed === null) {
      followed.current = null
      place(0)
      return
    }
    if (followed.current !== feed) {
      followed.current = feed
      following.current = true
    }
    if (following.current) place(node.scrollHeight)
  }, [container, feed, change])
}
