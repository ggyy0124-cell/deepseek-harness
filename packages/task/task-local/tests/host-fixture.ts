/** In-process Task provider composition keeps real Session and SQLite behavior measurable by V8. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TaskSessionStore from '@deepseek-ai/dsh-task-session'
import TaskAgentRegistry from '@deepseek-ai/dsh-task-agent'
import TaskAgentLoop from '@deepseek-ai/dsh-task-agent-loop'
import TaskAgentPresets from '@deepseek-ai/dsh-task-agent-presets'
import TaskJsonlPersistence from '@deepseek-ai/dsh-task-session-persistence-jsonl'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskService, { type Config } from '../src/index.ts'

/** Mount the local provider with isolated persistence and no external model requests.
 * @param beforeTask - optional application services installed before Task initialization.
 * @param overrides - Task Local configuration for one isolated host.
 * @returns owned Context, workspace and awaited teardown.
 */
export async function taskHost(beforeTask?: (ctx: Context) => void | Promise<void>, overrides: Partial<Config> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'task-provider-host-'))
  const ctx = new Context()
  const close = async () => {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
  try {
    const preset = join(directory, 'presets', 'minimal')
    await mkdir(preset, { recursive: true })
    await writeFile(join(preset, 'agent.cordis.yml'), '- name: ./fixture.mjs\n')
    await writeFile(join(preset, 'fixture.mjs'), 'export function apply() {}\n')
    ctx.baseUrl = pathToFileURL(directory).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(TaskSessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubprocessLocal)
    await ctx.plugin(TaskAgentRegistry)
    await ctx.plugin(TaskJsonlPersistence, { root: join(directory, 'sessions'), compression: 'none' })
    await ctx.plugin(TaskAgentLoop, { agents: [] })
    await ctx.plugin(AgentDefaultModel, { provider: 'unused', model: 'unused' })
    await ctx.plugin(TaskAgentPresets, { default: 'minimal', roots: [{ path: join(directory, 'presets'), trust: 'user' }],
      includeShippedRoot: false, includeUserRoot: false })
    // Workspaces and permission selections have no external operations in these business stages.
    ctx.provide('permissionPresets', { set() {}, names: [], current: () => 'default' } as unknown as Context['permissionPresets'])
    ctx.provide('workspaceRegistry', { create: async () => ({ attachSession: async () => {} }) } as unknown as Context['workspaceRegistry'])
    // Schemastery's input type includes fields supplied by its runtime defaults.
    const config = LocalTaskService.Config({ path: join(directory, 'tasks.sqlite'), revisionRoot: join(directory, 'revisions'),
      resourceRoot: join(directory, 'resources'), tickMs: 10, ...overrides } as Config)
    await beforeTask?.(ctx)
    await ctx.plugin(LocalTaskService, config)
    return { ctx, directory, close }
  } catch (error) { await close(); throw error }
}
