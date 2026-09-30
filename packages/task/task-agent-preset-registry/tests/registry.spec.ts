/** Recorded Task preset revisions over the shared declarative preset registry. */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresetRegistry, { livePresetMounts, type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { createScope } from '@deepseek-ai/dsh-scope'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TaskAgentPresetRegistry, {
  parseTaskPresetRevision, taskAgentPresetRegistry, type TaskPresetRevision,
} from '../src/index.ts'

const fixture = (path: string): string => new URL(`./fixtures/${path}`, import.meta.url).href
const contribution = (tool: string): PresetDefinition['plugins'] => [{ name: fixture('plugins/contribute.js'), config: { tool } }]

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** A Host composition with the Task registry and an Agent factory, as the Task profile mounts them. */
async function harness(): Promise<{ ctx: Context; registryFiber: Fiber; registry: TaskAgentPresetRegistry }> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = fixture('')
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const registryFiber = await ctx.plugin(TaskAgentPresetRegistry, { default: 'standard' })
  return { ctx, registryFiber, registry: taskAgentPresetRegistry(ctx) }
}

/**
 * Declare a preset from its own row, as `@deepseek-ai/dsh-agent-preset` does.
 * @returns the declaring row; disposing it withdraws the declaration.
 */
async function declare(ctx: Context, definition: PresetDefinition, base: { baseUrl?: string | undefined } = {}): Promise<Fiber> {
  return await ctx.plugin({
    inject: ['agentPresets'],
    async* apply(row: Context) {
      const declaring = 'baseUrl' in base ? row.extend({ baseUrl: base.baseUrl }) : row
      yield await declaring.agentPresets.register(definition)
    },
  })
}

async function agentOn(ctx: Context, id: string, revision: TaskPresetRevision): Promise<AgentHandle> {
  return await ctx.agents.create({
    sessionId: SessionId(id),
    setup: async (agentCtx: Context) => { await taskAgentPresetRegistry(ctx).mountRevision(agentCtx, revision) },
  })
}

const tools = (ctx: Context, key: object): string[] => ctx.tools.schemas(key).map(schema => schema.name)
const presetRows = async (registry: TaskAgentPresetRegistry): Promise<string[]> => (await registry.list()).map(row => row.id)

describe('recording a revision', () => {
  it('records the declared composition, its resolution base, and a verifiable digest', async () => {
    const { ctx, registry } = await harness()
    await declare(ctx, { id: 'standard', plugins: contribution('standard') })

    const revision = await registry.captureRevision('standard')

    expect(revision).toMatchObject({ preset: 'standard', baseUrl: fixture('') })
    expect(revision.plugins).toContain('plugins/contribute.js')
    expect(revision.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(parseTaskPresetRevision({ ...revision })).toEqual(revision)
    expect(() => parseTaskPresetRevision({ ...revision, plugins: `${revision.plugins}# edited\n` }))
      .toThrow('does not match its digest')
    expect(() => parseTaskPresetRevision({ ...revision, digest: 'short' })).toThrow()
    expect(() => parseTaskPresetRevision({ ...revision, extra: true })).toThrow()
  })

  it('refuses unknown and unusable presets', async () => {
    const { ctx, registry } = await harness()
    await declare(ctx, { id: 'standard', plugins: contribution('standard') })
    await declare(ctx, { id: 'broken', plugins: [{ name: fixture('plugins/throws.js'), config: { message: 'row refused' } }] })

    const unknown = registry.captureRevision('missing')
    await expect(unknown).rejects.toBeInstanceOf(RemoteError)
    await expect(unknown).rejects.toMatchObject({
      code: 'agent-preset/not-found', details: { agentPreset: 'missing', available: ['standard', 'broken'] },
    })
    await expect(registry.captureRevision('broken')).rejects.toMatchObject({ code: 'agent-preset/invalid' })
    await expect(registry.captureRevision('broken')).rejects.toThrow('row refused')
  })

  it('records the replacement when the declaration changes while its health is read', async () => {
    const { ctx, registry } = await harness()
    let declaring = await declare(ctx, { id: 'standard', plugins: contribution('standard') })
    const resolve = registry.resolve.bind(registry)
    vi.spyOn(registry, 'resolve').mockImplementationOnce(async (id) => {
      await declaring.dispose()
      declaring = await declare(ctx, { id: 'standard', plugins: contribution('replacement') })
      return await resolve(id)
    })

    const revision = await registry.captureRevision('standard')

    expect(revision.plugins).toContain('replacement')
    expect(revision).toEqual(await registry.captureRevision('standard'))
  })

  it('reports a declaration withdrawn while its health is read', async () => {
    const { ctx, registry } = await harness()
    const declaring = await declare(ctx, { id: 'standard', plugins: contribution('standard') })
    const resolve = registry.resolve.bind(registry)
    vi.spyOn(registry, 'resolve').mockImplementationOnce(async (id) => {
      const health = await resolve(id)
      await declaring.dispose()
      return health
    })

    await expect(registry.captureRevision('standard')).rejects.toMatchObject({ code: 'agent-preset/not-found' })
  })

  it('reserves revision ids and keeps the first of two declarations of one id', async () => {
    const { ctx, registry } = await harness()
    await declare(ctx, { id: 'standard', plugins: contribution('standard') })

    await expect(registry.register({ id: 'task-revision:standard:forged', plugins: contribution('forged') }))
      .rejects.toThrow('reserved for Task revisions')
    await expect(registry.register({ id: 'standard', plugins: contribution('duplicate') }))
      .rejects.toThrow('Duplicate agent preset')
    expect((await registry.captureRevision('standard')).plugins).toContain('tool: standard')
  })
})

describe('mounting a revision', () => {
  it('joins the live declaration while the recorded revision is current', async () => {
    const { ctx, registry } = await harness()
    await declare(ctx, { id: 'standard', plugins: contribution('standard') })
    const revision = await registry.captureRevision('standard')

    const { agent } = await agentOn(ctx, 'current', revision)

    expect(tools(ctx, agent)).toEqual(['standard'])
    expect(registry.composedPreset(agent.ctx)).toBe('standard')
    expect(livePresetMounts(ctx.fiber)).toHaveLength(1)
    const bare = createScope(ctx, {})
    expect(registry.composedPreset(bare.ctx)).toBeUndefined()
    await bare.dispose()
  })

  it('keeps a recorded revision after its declaration changes and shares one private tree', async () => {
    const { ctx, registry } = await harness()
    const declaring = await declare(ctx, { id: 'standard', plugins: contribution('standard') })
    const revision = await registry.captureRevision('standard')
    await declaring.dispose()
    await declare(ctx, { id: 'standard', plugins: contribution('replacement') })

    const first = await agentOn(ctx, 'first', revision)
    const second = await agentOn(ctx, 'second', revision)

    expect(tools(ctx, first.agent)).toEqual(['standard'])
    expect(tools(ctx, second.agent)).toEqual(['standard'])
    expect(registry.composedPreset(first.agent.ctx)).toBe('standard')
    expect(livePresetMounts(ctx.fiber)).toHaveLength(2)
    expect(await presetRows(registry)).toEqual(['standard'])
    expect((await registry.remoteExportList()).presets.map(row => row.id)).toEqual(['standard'])
    expect((await registry.compositionInventory()).map(row => row.id)).toEqual(['standard'])
    expect((await registry.captureRevision('standard')).plugins).toContain('replacement')

    const childKey = {}
    const child = createScope(ctx, childKey)
    expect(registry.composeFrom(child.ctx, first.agent.ctx)).toBe('standard')
    expect(tools(ctx, childKey)).toEqual(['standard'])
    await first.dispose()
    await second.dispose()
    // The child joined the private tree, which stays until it leaves.
    expect(livePresetMounts(ctx.fiber)).toHaveLength(2)
    await child.dispose()
    expect(livePresetMounts(ctx.fiber)).toHaveLength(1)

    const again = await agentOn(ctx, 'again', revision)
    expect(tools(ctx, again.agent)).toEqual(['standard'])
    expect(livePresetMounts(ctx.fiber)).toHaveLength(2)
    await again.dispose()
    expect(livePresetMounts(ctx.fiber)).toHaveLength(1)
  })

  it('composes nothing from a parent without a preset', async () => {
    const { ctx, registry } = await harness()
    const parent = createScope(ctx, {})
    const child = createScope(ctx, {})
    expect(registry.composeFrom(child.ctx, parent.ctx)).toBeUndefined()
    await child.dispose()
    await parent.dispose()
  })

  it('resolves a private revision from the base its declaring row used', async () => {
    const { ctx, registry } = await harness()
    const relative = await declare(ctx, { id: 'relative', plugins: [{ name: './contribute.js', config: { tool: 'relative' } }] },
      { baseUrl: fixture('elsewhere/') })
    const absolute = await declare(ctx, { id: 'absolute', plugins: contribution('absolute') }, { baseUrl: undefined })
    const relativeRevision = await registry.captureRevision('relative')
    const absoluteRevision = await registry.captureRevision('absolute')
    await relative.dispose()
    await absolute.dispose()

    expect(relativeRevision.baseUrl).toBe(fixture('elsewhere/'))
    expect(absoluteRevision.baseUrl).toBeNull()
    expect(tools(ctx, (await agentOn(ctx, 'relative', relativeRevision)).agent)).toEqual(['relative'])
    expect(tools(ctx, (await agentOn(ctx, 'absolute', absoluteRevision)).agent)).toEqual(['absolute'])
    expect(await presetRows(registry)).toEqual([])
  })

  it('rebinds an Agent to the recorded revision when its declaration changes during binding', async () => {
    const { ctx, registry } = await harness()
    let declaring = await declare(ctx, { id: 'standard', plugins: contribution('standard') })
    const revision = await registry.captureRevision('standard')
    const mount = registry.mount.bind(registry)
    vi.spyOn(registry, 'mount').mockImplementationOnce(async (agentCtx, id) => {
      const bound = await mount(agentCtx, id)
      await declaring.dispose()
      declaring = await declare(ctx, { id: 'standard', plugins: contribution('replacement') })
      return bound
    })

    const { agent } = await agentOn(ctx, 'rebound', revision)

    expect(tools(ctx, agent)).toEqual(['standard'])
    expect(registry.composedPreset(agent.ctx)).toBe('standard')
    expect(livePresetMounts(ctx.fiber)).toHaveLength(2)
  })

  it('releases a private revision that fails to mount and refuses malformed revisions', async () => {
    const { ctx, registry } = await harness()
    await declare(ctx, { id: 'standard', plugins: contribution('standard') })
    const recorded = await registry.captureRevision('standard')
    const refusing: TaskPresetRevision = {
      ...recorded,
      plugins: `- name: ${fixture('plugins/throws.js')}\n  config:\n    message: recorded row refused\n`,
      digest: 'f'.repeat(64),
    }
    const scope = createScope(ctx, {})

    await expect(registry.mountRevision(scope.ctx, refusing)).rejects.toThrow('recorded row refused')
    expect(livePresetMounts(ctx.fiber)).toHaveLength(1)
    await expect(registry.mountRevision(scope.ctx, refusing)).rejects.toThrow('recorded row refused')
    await expect(registry.mountRevision(scope.ctx, { ...recorded, plugins: 'name: not-a-list\n', digest: 'e'.repeat(64) }))
      .rejects.toThrow('top-level list of plugin rows')
    expect(livePresetMounts(ctx.fiber)).toHaveLength(1)
    expect(await presetRows(registry)).toEqual(['standard'])
    await scope.dispose()
  })

  it('refuses a private revision after the registry unloads', async () => {
    const { ctx, registryFiber, registry } = await harness()
    await declare(ctx, { id: 'standard', plugins: contribution('standard') })
    const revision = await registry.captureRevision('standard')
    await registryFiber.dispose()
    const scope = createScope(ctx, {})

    await expect(registry.mountRevision(scope.ctx, revision)).rejects.toThrow('not active')
    expect(livePresetMounts(ctx.fiber)).toHaveLength(0)
    await scope.dispose()
  })
})

describe('resolving the Task registry', () => {
  it('requires the Task replacement rather than the shared registry', async () => {
    const { registry } = await harness()
    expect(registry).toBeInstanceOf(TaskAgentPresetRegistry)

    const shared = new Context()
    contexts.push(shared)
    await shared.plugin(Loader)
    await shared.plugin(SessionProjectionRegistry)
    await shared.plugin(AgentPresetRegistry, { default: 'standard' })
    expect(() => taskAgentPresetRegistry(shared)).toThrow('requires @deepseek-ai/dsh-task-agent-preset-registry')
  })
})
