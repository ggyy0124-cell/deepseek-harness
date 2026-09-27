/** Durable journal delivery with stable identities and acknowledged replay. */
import type { TaskDatabase } from './database.ts'

import type { TaskNotificationProvider } from '@deepseek-ai/dsh-task'
export type { TaskNotificationProvider } from '@deepseek-ai/dsh-task'
const events = new Set(['stage.waiting', 'stage.blocked', 'admission.blocked', 'cleanup.blocked',
  'run.ended', 'interaction.opened', 'cancel.timeout', 'cleanup.timeout', 'shutdown.timeout'])

/** Serial delivery retains failed entries and drains before database closure. */
export class TaskNotifications {
  private readonly abort = new AbortController()
  private pending: Promise<void> | undefined
  constructor(private readonly db: TaskDatabase, private readonly provider: TaskNotificationProvider,
    private readonly batchSize: number, private readonly providerId = 'log') {}
  /** Deliver one bounded page; concurrent callers share the same attempt.
   * @returns completion of this page, rejecting on delivery failure for later retry.
   */
  flush(): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve()
    this.pending ??= this.deliver().finally(() => { this.pending = undefined })
    return this.pending
  }
  /** Cancel delivery and await provider quiescence.
   * @returns completion after the active provider call settles.
   */
  async close(): Promise<void> {
    this.abort.abort()
    try { await this.pending } catch { /* Delivery failures remain unacknowledged for restart. */ }
  }
  private async deliver(): Promise<void> {
    for (const entry of this.db.journal(this.db.notificationCursor(this.providerId), this.batchSize)) {
      this.abort.signal.throwIfAborted()
      if (events.has(entry.event)) {
        const { sequence, runId, event, at } = entry
        await this.provider.deliver(this.db.id, { sequence, runId, event, at }, this.abort.signal)
      }
      this.db.acknowledgeNotification(entry.sequence, this.providerId)
    }
  }
}
