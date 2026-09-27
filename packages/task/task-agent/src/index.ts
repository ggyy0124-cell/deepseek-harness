/** Task Profile replacement for the shared Agent registry. */
import type { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentHandle, type CreateAgentOptions, type ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

type CreationGuard = (initiator: Agent | undefined, owner: Agent | undefined, id: SessionId, operation: 'create' | 'resume' | 'enter') => void

/** Agent registry with Task Profile creation authorization. */
export class TaskAgentRegistry extends AgentRegistry {
  private readonly creationGuards = new Set<CreationGuard>()
  private readonly creationFailures = new Set<(id: SessionId) => void>()

  /** Register a check before an Agent is created or published.
   * @param guard - check of the causal initiator and requested runtime parent.
   * @param onFailure - settle a reservation when factory creation rolls back before publication.
   * @returns effect-scoped guard removal.
   */
  guardCreation(guard: CreationGuard, onFailure?: (id: SessionId) => void): () => void {
    const dispose = this.ctx.effect(() => {
      this.creationGuards.add(guard)
      if (onFailure !== undefined) this.creationFailures.add(onFailure)
      return () => { this.creationGuards.delete(guard); if (onFailure !== undefined) this.creationFailures.delete(onFailure) }
    }, 'taskAgents.guardCreation')
    return () => { void dispose() }
  }

  private assertCreation(owner: Agent | undefined, id: SessionId, operation: 'create' | 'resume' | 'enter'): void {
    const initiator = this.currentInitiator()
    for (const guard of this.creationGuards) guard(initiator, owner, id, operation)
  }

  override async create(options: CreateAgentOptions): Promise<AgentHandle> {
    this.assertCreation(options.parentAgent, options.sessionId, 'create')
    try { return await super.create(options) }
    catch (error) {
      for (const failed of this.creationFailures) failed(options.sessionId)
      throw error
    }
  }

  override async resume(options: ResumeAgentOptions): Promise<AgentHandle> {
    this.assertCreation(options.parentAgent, options.resumeSessionId, 'resume')
    return await super.resume(options)
  }

  override enter(agent: Agent, owner: Agent | undefined): () => void {
    this.assertCreation(owner, agent.id, 'enter')
    return super.enter(agent, owner)
  }
}

/** Resolve the Task Profile Agent replacement.
 * @param ctx - context whose Agent provider must be task-aware.
 * @returns installed Task Agent registry.
 */
export function taskAgentRegistry(ctx: Context): TaskAgentRegistry {
  const agents = ctx.get('agents')
  if (!(agents instanceof TaskAgentRegistry)) throw new Error('Task Profile requires @deepseek-ai/dsh-task-agent')
  return agents
}

export default TaskAgentRegistry
