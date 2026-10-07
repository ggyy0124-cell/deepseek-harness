/** Keyboard handling of the text boxes that send on Enter. */
import type { KeyboardEvent } from 'react'

/** Key handler of a multi-line text box that sends on Enter and breaks the line on Shift+Enter.
 * The Enter that confirms an IME candidate is neither a send nor a line break.
 * @param send - called for a plain Enter after the line break was prevented; it decides whether the content can be sent.
 * @returns `onKeyDown` handler.
 */
export function sendOnEnter(send: () => void): (event: KeyboardEvent<HTMLTextAreaElement>) => void {
  return (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // oxlint-disable-next-line typescript/no-deprecated -- Safari reports the IME-confirming Enter as keyCode 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    send()
  }
}
