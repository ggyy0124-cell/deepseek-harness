/** Task Profile replacement for JSONL Session persistence. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionAccess, SessionHandle, SessionPersistenceCreateOptions, SessionPersistenceOpenOptions } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence, { type Config as JsonlConfig } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { taskSessionStore } from '@deepseek-ai/dsh-task-session'

/** Task JSONL configuration, identical to the shared provider configuration. */
export interface Config extends JsonlConfig {}

/** JSONL backend that applies Task Session authorization before write ownership. */
export class TaskJsonlSessionPersistence extends JsonlSessionPersistence {
  private readonly taskCtx: Context

  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.taskCtx = ctx
  }

  override async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    taskSessionStore(this.taskCtx).assertWritable(header.id)
    return await super.create(header, options)
  }

  override async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    if (access === 'write') taskSessionStore(this.taskCtx).assertWritable(id)
    return await super.open(id, access, options)
  }
}

export default TaskJsonlSessionPersistence
