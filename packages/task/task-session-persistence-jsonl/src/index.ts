/**
 * Task Profile JSONL Session persistence: the shared JSONL plugin behind Task Session write authorization.
 * @module @deepseek-ai/dsh-task-session-persistence-jsonl
 */
import { Context } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionPersistence,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { taskSessionStore } from '@deepseek-ai/dsh-task-session'

/** Task JSONL persistence plugin label. */
export const name = 'task-session-persistence-jsonl'

/** Task JSONL configuration, identical to the shared backend configuration. */
export type Config = JsonlSessionPersistence.Config

/** Loader schema of the shared backend: storage root, physical encoding, and listing concurrency. */
export const Config = JsonlSessionPersistence.Config

/** `sessionPersistence` provider that checks Task Session authority before the shared backend takes write ownership. */
class TaskJsonlSessionPersistence extends SessionPersistence {
  constructor(ctx: Context, private readonly backend: SessionPersistence) {
    super(ctx)
  }

  override async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    taskSessionStore(this.ctx).assertWritable(header.id)
    return await this.backend.create(header, options)
  }

  override async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    if (access === 'write') taskSessionStore(this.ctx).assertWritable(id)
    return await this.backend.open(id, access, options)
  }

  override flush(): Promise<void> {
    return this.backend.flush()
  }

  override stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    return this.backend.stat(id, options)
  }

  override list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    return this.backend.list(options)
  }
}

/**
 * Mount the shared JSONL backend under an isolated `sessionPersistence` key and provide the authorized provider under the
 * ordinary key for exactly the backend's lifetime. Unloading this row removes the authorized provider first, so its consumers
 * unload while the backend still holds their handles; the backend then runs its own retained teardown.
 * @param ctx - the owning plugin context.
 * @param config - the backend's storage root, physical encoding, and listing concurrency.
 * @returns resolves when the backend service is ready.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const backend = ctx.isolate('sessionPersistence')
  const mounted = backend.plugin(JsonlSessionPersistence, config)
  const ordinary = ctx[Context.isolate]
  backend.inject(['sessionPersistence'], (inner) => {
    // The provider's own fiber carries the ordinary isolation, so its activation notifies waiting consumers.
    inner.extend({ [Context.isolate]: ordinary }).plugin({
      name: 'task-session-persistence-jsonl-service',
      apply: (scope: Context) => { new TaskJsonlSessionPersistence(scope, inner.sessionPersistence) },
    })
  })
  await mounted.await()
}
