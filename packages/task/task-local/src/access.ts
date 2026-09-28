/** Explicit asynchronous authority for task-owned Session mutations. */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Process-local owner authority, never inferred from a client-supplied Session id. */
export class TaskSessionAccess {
  private readonly active = new AsyncLocalStorage<{
    readonly owner: SessionId
    readonly model?: { readonly key: string; active: boolean }
    readonly cancellation?: true
  }>()
  /** Enter the owner while an adapter operation runs.
   *
   * @param id - owned Session.
   * @param operation - adapter work.
   * @returns operation result.
   */
  run<T>(id: SessionId, operation: () => T): T { return this.active.run({ owner: id }, operation) }
  /** Admit one model turn and revoke child creation when its promise settles.
   * @param id - owning root Session.
   * @param key - durable model operation identity.
   * @param operation - active model turn.
   * @returns operation result.
   */
  model<T>(id: SessionId, key: string, operation: () => Promise<T>): Promise<T> {
    const model = { key, active: true }
    return this.active.run({ owner: id, model }, async () => {
      try { return await operation() }
      finally { model.active = false }
    })
  }
  /** Identify the admitted model operation that may own foreground children.
   * @returns root Session and operation key, if the caller is inside that operation.
   */
  modelOwner(): { readonly owner: SessionId; readonly modelKey: string } | undefined {
    const current = this.active.getStore()
    return current?.model?.active === true ? { owner: current.owner, modelKey: current.model.key } : undefined
  }
  /** Authorize cancellation propagation from a Task root to its live children.
   * @param id - owning root Session.
   * @param operation - synchronous cancellation fan-out.
   * @returns operation result.
   */
  cancel<T>(id: SessionId, operation: () => T): T {
    return this.active.run({ owner: id, cancellation: true }, operation)
  }
  /** Check whether the caller is draining children for an owned cancellation.
   * @param id - owning root Session.
   * @returns true only during Task cancellation propagation.
   */
  isCancelling(id: SessionId): boolean {
    const current = this.active.getStore()
    return current?.owner === id && current.cancellation === true
  }
  /** Reject generic Session mutations outside the task adapter.
   *
   * @param id - managed Session.
   */
  assert(id: SessionId): void {
    if (this.active.getStore()?.owner !== id) throw new Error('task-owned Session: use task input, confirmation, or cancellation commands')
  }
}
