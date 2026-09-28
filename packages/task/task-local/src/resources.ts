/** Durable resource acquisition and reverse-order cleanup, separate from execution permit leases. */
import type { TaskResourceHandler, TaskResourceRecord, TaskRunId } from '@deepseek-ai/dsh-task'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { TaskDatabase } from './database.ts'

/** Every external resource retains its intent until cleanup confirms quiescence. */
export class TaskResources {
  constructor(private readonly db: TaskDatabase, private readonly handlers: Readonly<Record<string, TaskResourceHandler>>,
    private readonly log: (event: string, details: JsonValue) => void) {}

  /** Acquire or reconcile a stable resource identity.
   * @param runId - owning execution.
   * @param key - plugin-selected identity, unique within the execution.
   * @param type - adapter name.
   * @param request - non-secret recovery data.
   * @param signal - owning stage lifetime.
   * @returns confirmed resource handle.
   */
  async acquire(runId: TaskRunId, key: string, type: string, request: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    signal.throwIfAborted()
    if (!key.trim() || !type.trim()) throw new Error('Task resource identity must not be empty')
    const handler = this.handler(type)
    const previous = this.db.managedResources(runId).find(value => value.key === key)
    if (previous !== undefined && (previous.type !== type || JSON.stringify(previous.request) !== JSON.stringify(request)))
      throw new Error('Task resource identity already names a different acquisition')
    if (previous?.state === 'ready') return previous.value
    if (previous?.state === 'released' || previous?.state === 'cleaning') throw new Error('Task resource is retired')
    const record: TaskResourceRecord = previous ?? { runId, key, type, request, value: null, state: 'prepared' }
    this.db.putResource(record)
    this.log(previous === undefined ? 'resource.prepared' : 'resource.reconciling', { key, type })
    const value = await (previous === undefined ? handler.acquire(record, signal) : handler.reconcile(record, signal))
    this.db.putResource({ ...record, value, state: 'ready' })
    this.log('resource.ready', { key, type })
    return value
  }

  /** Clean confirmed and uncertain acquisitions before releasing Run locks.
   * @param runId - owning execution.
   * @param signal - cleanup deadline.
   * @returns completion after every resource is released; failures retain durable progress.
   */
  async cleanup(runId: TaskRunId, signal: AbortSignal): Promise<void> {
    for (const record of this.db.managedResources(runId).reverse()) {
      if (record.state === 'released') continue
      signal.throwIfAborted()
      this.db.putResource({ ...record, state: 'cleaning' })
      try {
        await this.handler(record.type).cleanup(record, signal)
        signal.throwIfAborted()
        this.db.putResource({ ...record, state: 'released' })
        this.log('resource.released', { key: record.key, type: record.type })
      } catch (error) {
        this.db.putResource({ ...record, state: 'blocked' })
        this.log('resource.cleanup-blocked', { key: record.key, type: record.type })
        throw error
      }
    }
  }

  private handler(type: string): TaskResourceHandler {
    const handler = this.handlers[type]
    if (handler === undefined) throw new Error('Task resource adapter is unavailable; retained code is required')
    return handler
  }
}
