/** Task Profile replacement for the shared Session provider. */
import type { Context } from '@deepseek-ai/cordis'
import SessionStore, { type CreateSessionOptions, type PrepareSessionOptions, type Session, type SessionForkSource, type SessionId, type SessionSeq } from '@deepseek-ai/dsh-session'

interface MutationPolicy {
  readonly owns: (id: SessionId) => boolean
  readonly assert: (id: SessionId) => void
}

/** Session registry with Task Profile mutation authorization. */
export class TaskSessionStore extends SessionStore {
  private readonly mutationPolicies = new Set<MutationPolicy>()

  /** Register one task ownership policy.
   * @param owns - identifies Sessions governed by the policy.
   * @param assert - rejects a mutation outside the owner's active operation.
   * @returns effect-scoped policy removal.
   */
  guardMutations(owns: MutationPolicy['owns'], assert: MutationPolicy['assert']): () => void {
    const policy = { owns, assert }
    const dispose = this.ctx.effect(() => {
      this.mutationPolicies.add(policy)
      return () => { this.mutationPolicies.delete(policy) }
    }, 'taskSessions.guardMutations')
    return () => { void dispose() }
  }

  /** Check every policy that owns a Session before mutation.
   * @param id - Session selected for mutation.
   */
  assertWritable(id: SessionId): void {
    for (const policy of this.mutationPolicies) if (policy.owns(id)) policy.assert(id)
  }

  override create(id?: SessionId, options?: CreateSessionOptions): Session {
    if (id !== undefined) this.assertWritable(id)
    return super.create(id, options)
  }

  override prepare(id?: SessionId, options?: PrepareSessionOptions): Session {
    if (id !== undefined) this.assertWritable(id)
    return super.prepare(id, options)
  }

  override enter(session: Session): () => void {
    this.assertWritable(session.id)
    return super.enter(session)
  }

  override fork(source: SessionForkSource, boundary?: SessionSeq, childSessionId?: SessionId): Session {
    const sourceId = typeof source === 'string' ? source : source.id
    this.assertWritable(sourceId)
    if (childSessionId !== undefined) this.assertWritable(childSessionId)
    return super.fork(source, boundary, childSessionId)
  }
}

/** Resolve the Task Profile Session replacement.
 * @param ctx - context whose Session provider must be task-aware.
 * @returns installed Task Session store.
 */
export function taskSessionStore(ctx: Context): TaskSessionStore {
  const sessions = ctx.get('sessions')
  if (!(sessions instanceof TaskSessionStore)) throw new Error('Task Profile requires @deepseek-ai/dsh-task-session')
  return sessions
}

export default TaskSessionStore
