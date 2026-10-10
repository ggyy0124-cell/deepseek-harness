/** Keyboard handling of the text boxes that send on Enter. */
import type { KeyboardEvent } from 'react'

/** Media query of a device whose primary input is touch. Its on-screen keyboard has no Shift+Enter, so there Enter breaks the line
 * and the send button sends; `app.css` hides the Enter hints under the same query. */
export const TOUCH_INPUT_QUERY = '(hover: none) and (pointer: coarse)'

/** Key handler of a multi-line text box that sends on Enter and breaks the line on Shift+Enter.
 * The Enter that confirms an IME candidate is neither a send nor a line break, and on a {@link TOUCH_INPUT_QUERY} device every
 * Enter breaks the line.
 * @param send - called for a plain Enter after the line break was prevented; it decides whether the content can be sent.
 * @returns `onKeyDown` handler.
 */
export function sendOnEnter(send: () => void): (event: KeyboardEvent<HTMLTextAreaElement>) => void {
  return (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // oxlint-disable-next-line typescript/no-deprecated -- Safari reports the IME-confirming Enter as keyCode 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (window.matchMedia(TOUCH_INPUT_QUERY).matches) return
    event.preventDefault()
    send()
  }
}
