/**
 * Task Profile replacement for the Agent preset registry. Presets are declared
 * exactly as in other profiles; a Task run additionally records the declared
 * child plugin list it started with and remounts that revision across waits
 * and process restarts.
 * @module @deepseek-ai/dsh-task-agent-preset-registry
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import AgentPresetRegistry, {
  entryListProblem, type AgentPreset, type Config, type PresetDefinition,
} from '@deepseek-ai/dsh-agent-preset-registry'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { dump, load } from 'js-yaml'
import { z } from 'zod'

/** Registration ids this registry reserves for recorded revisions; hidden from every roster read. */
const REVISION_PREFIX = 'task-revision:'

/** A declared preset composition recorded by a Task run before its first mount. */
export interface TaskPresetRevision {
  /** Declared preset id the run selected. */
  readonly preset: string
  /** The declared child plugin list as entry-list YAML, `!!js` expressions included. */
  readonly plugins: string
  /** Resolution base of the declaring row, or null when it carried none. */
  readonly baseUrl: string | null
  /** SHA-256 over the preset id, resolution base, and plugin list. */
  readonly digest: string
}

const revisionSchema = z.strictObject({
  preset: z.string().min(1),
  plugins: z.string(),
  baseUrl: z.string().nullable(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
})

function revisionDigest(preset: string, baseUrl: string | null, plugins: string): string {
  return createHash('sha256').update(JSON.stringify([preset, baseUrl, plugins])).digest('hex')
}

/**
 * Validate a revision read back from durable Task storage.
 * @param value - the stored JSON value.
 * @returns the revision.
 * @throws when the record is malformed or its digest disagrees with its content.
 */
export function parseTaskPresetRevision(value: unknown): TaskPresetRevision {
  const revision = revisionSchema.parse(value)
  if (revisionDigest(revision.preset, revision.baseUrl, revision.plugins) !== revision.digest) {
    throw new Error(`task preset revision of "${revision.preset}" does not match its digest`)
  }
  return revision
}

function isRevisionId(id: string): boolean {
  return id.startsWith(REVISION_PREFIX)
}

/** The declared preset a registration id stands for; revision ids end in `:<uuid>`. */
function declaredPreset(id: string): string {
  return isRevisionId(id) ? id.slice(REVISION_PREFIX.length, id.lastIndexOf(':')) : id
}

/** One declaration as its declaring row registered it, with the revision it currently describes. */
interface Declaration {
  readonly definition: PresetDefinition
  readonly revision: TaskPresetRevision
}

/** One private registration of a revision that differs from the current declaration. */
interface Lease {
  readonly id: string
  users: number
  readonly registered: Promise<() => Promise<void>>
}

/** Agent preset registry that keeps each Task run on the composition it recorded. */
export class TaskAgentPresetRegistry extends AgentPresetRegistry {
  /** The service's own context; revision registrations extend it with the captured resolution base. */
  private readonly service: Context
  private readonly declarations = new Map<string, Declaration>()
  /** Private registrations by revision digest, shared by every Agent mounting that revision. */
  private readonly leases = new Map<string, Lease>()
  /** Revision ids between lease creation and their registration call. */
  private readonly admitted = new Set<string>()

  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.service = ctx
  }

  /**
   * Register a declaration and record the revision it describes.
   * @param definition - configuration supplied by the declaring row.
   * @returns the declaring row's disposer.
   * @throws when a declaring row uses an id reserved for Task revisions.
   */
  override async register(definition: PresetDefinition): Promise<() => Promise<void>> {
    if (isRevisionId(definition.id)) {
      if (!this.admitted.delete(definition.id)) {
        throw new Error(`Agent preset ids starting with "${REVISION_PREFIX}" are reserved for Task revisions`)
      }
      return await super.register(definition)
    }
    // The registry rejects the duplicate; the recorded declaration stays the one already registered.
    if (this.declarations.has(definition.id)) return await super.register(definition)
    const baseUrl = this.ctx.baseUrl ?? null
    const plugins = dump(definition.plugins, { schema: entryListSchema, noRefs: true, lineWidth: -1 })
    const declaration: Declaration = {
      definition,
      revision: { preset: definition.id, plugins, baseUrl, digest: revisionDigest(definition.id, baseUrl, plugins) },
    }
    this.declarations.set(definition.id, declaration)
    const unregister = await super.register(definition)
    // The registry removes its definition in the same tick, so a successor cannot register in between.
    return async () => {
      this.declarations.delete(definition.id)
      await unregister()
    }
  }

  /**
   * Record the current declaration of a usable preset.
   * @param preset - declared preset id.
   * @returns the revision a Task run stores before its first mount.
   * @throws {RemoteError} `agent-preset/not-found` for an undeclared id, or
   * `agent-preset/invalid` when the declaration cannot activate.
   */
  async captureRevision(preset: string): Promise<TaskPresetRevision> {
    const declaration = this.declarations.get(preset)
    if (declaration === undefined) {
      throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${preset}`,
        { agentPreset: preset, available: [...this.declarations.keys()] })
    }
    const { broken } = await this.resolve(preset)
    // The declaration was replaced while its health was read: record the replacement instead.
    if (this.declarations.get(preset) !== declaration) return await this.captureRevision(preset)
    if (broken !== undefined) throw new RemoteError('agent-preset/invalid', broken, { agentPreset: preset, reason: broken })
    return declaration.revision
  }

  /**
   * Bind an unpublished Agent to a recorded revision. A revision equal to the
   * current declaration joins that declaration's live tree; any other revision
   * mounts a private tree shared by the Agents that recorded it.
   * @param ctx - Agent context from its setup callback.
   * @param revision - the composition the Task run recorded.
   * @returns the declared preset id the revision was recorded from.
   * @throws when the revision cannot activate or one of its rows stays unusable.
   */
  async mountRevision(ctx: Context, revision: TaskPresetRevision): Promise<AgentPreset> {
    const declaration = this.declarations.get(revision.preset)
    if (declaration?.revision.digest === revision.digest) {
      await this.mount(ctx, revision.preset)
      if (this.declarations.get(revision.preset) === declaration) return { id: revision.preset }
      // The declaration changed while the Agent bound; the private mount below rebinds it.
    }
    const lease = this.lease(revision)
    try {
      await lease.registered
      await this.mount(ctx, lease.id)
    } catch (error) {
      await this.release(revision.digest, lease)
      throw error
    }
    ctx.effect(() => () => this.release(revision.digest, lease), 'task-agent-preset-registry.revision')
    return { id: revision.preset }
  }

  private lease(revision: TaskPresetRevision): Lease {
    let lease = this.leases.get(revision.digest)
    if (lease === undefined) {
      const plugins: unknown = load(revision.plugins, { schema: entryListSchema })
      const problem = entryListProblem(plugins)
      if (problem !== undefined) throw new Error(`task preset revision of "${revision.preset}": ${problem}`)
      const registry = this.service.extend({ baseUrl: revision.baseUrl ?? undefined }).get('agentPresets')
      if (registry === undefined) throw new Error('the Task preset registry is not active')
      const id = `${REVISION_PREFIX}${revision.preset}:${randomUUID()}`
      this.admitted.add(id)
      lease = { id, users: 0, registered: registry.register({ id, plugins: plugins as PresetDefinition['plugins'] }) }
      this.leases.set(revision.digest, lease)
    }
    lease.users++
    return lease
  }

  private async release(digest: string, lease: Lease): Promise<void> {
    lease.users--
    if (lease.users !== 0) return
    this.leases.delete(digest)
    // Agents still bound, including inherited children, keep the retired tree until they leave.
    await (await lease.registered)()
  }

  /**
   * Read every declared preset; recorded revisions are not declarations.
   * @returns display metadata and loading diagnostics.
   */
  override async list(): Promise<AgentPreset[]> {
    return (await super.list()).filter(row => !isRevisionId(row.id))
  }

  /**
   * Read declared plugin rows without creating an Agent.
   * @returns declaration metadata and activation states.
   */
  override async compositionInventory(): ReturnType<AgentPresetRegistry['compositionInventory']> {
    return (await super.compositionInventory()).filter(row => !isRevisionId(row.id))
  }

  /**
   * Read the declared preset a live Agent uses, including one bound to a recorded revision.
   * @param ctx - Agent context.
   * @returns its preset id, if bound.
   */
  override composedPreset(ctx: Context): string | undefined {
    const id = super.composedPreset(ctx)
    return id === undefined ? undefined : declaredPreset(id)
  }

  /**
   * Join a child to the exact revision retained by its parent.
   * @param ctx - child Agent context.
   * @param parent - parent Agent context.
   * @returns the declared preset id, or undefined in a preset-free composition.
   */
  override composeFrom(ctx: Context, parent: Context): string | undefined {
    const id = super.composeFrom(ctx, parent)
    return id === undefined ? undefined : declaredPreset(id)
  }
}

/**
 * Resolve the Task Profile preset registry replacement.
 * @param ctx - context whose preset provider must retain Task revisions.
 * @returns the installed Task preset registry.
 */
export function taskAgentPresetRegistry(ctx: Context): TaskAgentPresetRegistry {
  const presets = ctx.get('agentPresets')
  if (!(presets instanceof TaskAgentPresetRegistry)) throw new Error('Task Profile requires @deepseek-ai/dsh-task-agent-preset-registry')
  return presets
}

export default TaskAgentPresetRegistry
