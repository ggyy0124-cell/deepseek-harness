/** Axis of the trajectory timeline: equal-width blocks or recorded durations, kept per browser. */
import { Store, useStore } from './store.ts'

const KEY = 'dsh-task-web.trajectory-duration'

function initial(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    return false // Storage may be unavailable; the timeline then starts with equal-width blocks.
  }
}

/** Whether the timeline sizes blocks by recorded duration instead of giving every record the same width. */
export const recordedDuration = new Store<boolean>(initial())

/** Choose the timeline axis and remember it in this browser.
 * @param value - true for recorded durations, false for equal-width blocks.
 */
export function setRecordedDuration(value: boolean): void {
  recordedDuration.set(value)
  try {
    localStorage.setItem(KEY, String(value))
  } catch {
    // Storage may be unavailable in private windows; the choice still applies to this page.
  }
}

/** Read the timeline axis inside React.
 * @returns true while recorded durations size the blocks.
 */
export function useRecordedDuration(): boolean {
  return useStore(recordedDuration)
}
