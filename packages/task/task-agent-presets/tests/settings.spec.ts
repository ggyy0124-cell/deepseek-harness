/**
 * The default preset is a user choice layered over the deployment default.
 * While mode selection is off, `config.default` remains the deployment's safe
 * default; once on, the volatile `selectedDefault` overrides it live.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { afterEach, describe, expect, it } from 'vitest'
import AgentPresets, { COMPOSITION_FILE, taskAgentPresets } from '@deepseek-ai/dsh-task-agent-presets'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ROOTS = [{ path: join(FIXTURES, 'system'), trust: 'system' as const }]

/** Every temp root and context created by this file, released after each test. */
const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A roster mounted behind the Loader so tests edit its raw entry configuration. */
async function harness(extraRoots: readonly { path: string; trust: 'system' | 'user' }[] = []) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const live = await liveConfig(ctx, AgentPresets, {
    default: 'standard', roots: [...ROOTS, ...extraRoots], includeShippedRoot: false, includeUserRoot: false,
  })
  return { ctx, live }
}

type ConfigChange = (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>

const toolNames = (ctx: Context, agent?: unknown): string[] =>
  ctx.tools.schemas(agent as never).map(schema => schema.name).sort()

describe('the default preset as a volatile user choice', () => {
  it('shows mode selection on the composition default by default', async () => {
    const { ctx, live } = await harness()

    expect((await taskAgentPresets(ctx).remoteExportList()).modeSelectionEnabled).toBe(true)
    expect(taskAgentPresets(ctx).defaultId).toBe('standard')

    await live.update({ modeSelectionEnabled: false })
    expect((await taskAgentPresets(ctx).remoteExportList()).modeSelectionEnabled).toBe(false)
    expect(taskAgentPresets(ctx).defaultId).toBe('standard')
  })

  it('updates the live service without replacing its fiber', async () => {
    const { live } = await harness()
    const before = live.fiber

    await live.update({ selectedDefault: 'minimal' })

    expect(live.entry.fiber === before).toBe(true)
  })

  it('temporarily ignores the selected default while selection is off', async () => {
    const { ctx, live } = await harness()

    await live.update({ selectedDefault: 'minimal' })
    expect(taskAgentPresets(ctx).defaultId).toBe('minimal')

    await live.update({ modeSelectionEnabled: false })
    expect(taskAgentPresets(ctx).defaultId).toBe('standard')

    await live.update({ modeSelectionEnabled: true })
    expect(taskAgentPresets(ctx).defaultId).toBe('minimal')
  })

  it('composes a new session from the selected default', async () => {
    const { ctx, live } = await harness()
    await live.update({ selectedDefault: 'minimal' })

    const handle = await ctx.agents.create({
      sessionId: SessionId('settings-default'),
      setup: async (agentCtx: Context) => void await taskAgentPresets(ctx).mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, handle.agent)).toEqual(['beta'])
    } finally {
      await handle.dispose()
    }
  })

  it('leaves a running session on the preset it was composed from', async () => {
    const { ctx, live } = await harness()
    const running = await ctx.agents.create({
      sessionId: SessionId('settings-running'),
      setup: async (agentCtx: Context) => void await taskAgentPresets(ctx).mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])

      // Changing the default mid-flight must not reach an agent that already
      // composed: its history was produced under `standard`'s tools.
      await live.update({ selectedDefault: 'minimal' })

      expect(taskAgentPresets(ctx).defaultId).toBe('minimal')
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])

      await live.update({ modeSelectionEnabled: false })

      expect(taskAgentPresets(ctx).defaultId).toBe('standard')
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])
    } finally {
      await running.dispose()
    }
  })

  it('re-inherits the composition default when the selected default is removed', async () => {
    const { ctx, live } = await harness()
    await live.update({ selectedDefault: 'minimal' })
    expect(taskAgentPresets(ctx).defaultId).toBe('minimal')

    await live.replace({
      default: 'standard', roots: ROOTS, includeShippedRoot: false, includeUserRoot: false,
    })

    expect((await taskAgentPresets(ctx).remoteExportList()).modeSelectionEnabled).toBe(true)
    expect(taskAgentPresets(ctx).defaultId).toBe('standard')
  })

  it('clears a selected default it has just deleted through the configuration editor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-authored-'))
    roots.push(root)
    await mkdir(join(root, 'mine'))
    await writeFile(
      join(root, 'mine', COMPOSITION_FILE),
      `- id: only\n  name: ${join(FIXTURES, 'plugins', 'contribute.js')}\n  config:\n    tool: only\n`,
    )
    const { ctx, live } = await harness([{ path: root, trust: 'user' as const }])
    const edits: Record<string, unknown>[] = []
    ctx.provide('configEditor', {
      edit: async (entry: unknown, change: ConfigChange) => {
        expect(entry).toBe(live.entry)
        const next = change(structuredClone(live.entry.options.config as Record<string, unknown>), {})
        edits.push(next)
        await live.replace(next)
      },
    } as never)
    await live.update({ selectedDefault: 'mine' })
    expect(taskAgentPresets(ctx).defaultId).toBe('mine')

    await taskAgentPresets(ctx).remove('mine')

    // Nothing will ever supply that id again, so leaving the selection pointed
    // at it would fail every session created without an explicit pick. Clearing
    // it exposes the deployment's own default underneath.
    expect(edits).toHaveLength(1)
    expect(edits[0]).not.toHaveProperty('selectedDefault')
    expect(taskAgentPresets(ctx).defaultId).toBe('standard')
    expect((await taskAgentPresets(ctx).resolve()).id).toBe('standard')
  })

  it('keeps a deleted preset that is not the selected default out of the configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-authored-'))
    roots.push(root)
    await mkdir(join(root, 'mine'))
    await writeFile(
      join(root, 'mine', COMPOSITION_FILE),
      `- id: only\n  name: ${join(FIXTURES, 'plugins', 'contribute.js')}\n  config:\n    tool: only\n`,
    )
    const { ctx } = await harness([{ path: root, trust: 'user' as const }])
    const edits: unknown[] = []
    ctx.provide('configEditor', { edit: async (...args: unknown[]) => { edits.push(args) } } as never)

    await taskAgentPresets(ctx).remove('mine')

    expect(edits).toEqual([])
  })

  it('reports an unknown selected default only when a session tries to use it', async () => {
    const { ctx, live } = await harness()

    // Selecting it succeeds — the roster is a live directory, so a name that is
    // absent now may exist by the time a session asks for it.
    await live.update({ selectedDefault: 'no-such-preset' })

    await expect(taskAgentPresets(ctx).resolve())
      .rejects.toThrow(/preset "no-such-preset" not found/)
  })
})
