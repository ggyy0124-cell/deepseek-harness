/** Retained loading evidence restores removed plugin entries while their installed version finishes cleanup. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { TaskDefinitionId } from '@deepseek-ai/dsh-task'
import { z } from 'zod'
import type { TaskDatabase } from './database.ts'
import type { TaskEngine } from './engine.ts'

const sourceSchema = z.object({ module: z.url().refine(value => value.startsWith('file:')), digest: z.string().regex(/^[a-f0-9]{64}$/), config: z.json() })
function digest(url: string): string { return createHash('sha256').update(readFileSync(fileURLToPath(url))).digest('hex') }

/** Package managers may remove or replace code only after retirement reports complete. */
export class TaskPluginCode {
  private readonly restoring = new Set<TaskDefinitionId>()
  private readonly recovered = new Map<TaskDefinitionId, Fiber>()
  private releasing: Promise<void> | undefined
  constructor(private readonly ctx: Context, private readonly db: TaskDatabase, private readonly engine: TaskEngine) {}

  /** Save the evaluated plugin configuration and resolved entry before admitting work.
   * @param owner - exact installed plugin context; programmatic test plugins have no Loader entry.
   * @param id - business definition whose code this entry provides.
   */
  capture(owner: Context, id: TaskDefinitionId): void {
    if (this.restoring.has(id)) return
    const entry = owner.fiber.entry
    if (entry === undefined) return
    const loader = this.ctx.loader.internal
    if (loader === undefined) throw new Error('Task plugin recovery requires the application module loader')
    const base = entry.parent.tree.ctx.baseUrl
    if (base === undefined) throw new Error('Task plugin entry has no resolution base')
    const resolved = loader.version === 'v1'
      ? loader.resolveSync(entry.options.name, base, {})
      : loader.resolveSync(base, { specifier: entry.options.name })
    const config: unknown = owner.fiber.config
    const source = sourceSchema.parse({ module: resolved.url, digest: digest(resolved.url), config: config ?? null })
    this.db.putPluginSource(id, source)
  }

  /** Restore cleanup for plugin entries removed while the Host was stopped.
   * @returns after the required code is loaded; each retirement drains independently.
   */
  async recover(): Promise<void> {
    await this.flush()
    const active = new Set(this.db.activeRuns().map(run => run.definitionId))
    for (const definition of this.db.definitions()) {
      const retirement = this.db.retirement(definition.id)
      if (this.recovered.has(definition.id) || definition.installed || (!active.has(definition.id) && (retirement === undefined || retirement.state === 'complete'))) continue
      this.engine.requestRetirement(definition.id)
      try {
        const source = sourceSchema.parse(this.db.pluginSource(definition.id))
        if (digest(source.module) !== source.digest) throw new Error('Retained Task plugin code changed')
        const loader = this.ctx.loader.internal
        if (loader === undefined) throw new Error('Task module loader is unavailable')
        const exports: unknown = await loader.import(source.module, source.module, {})
        const plugin = this.ctx.loader.unwrapExports(exports) as Parameters<Context['plugin']>[0]
        this.restoring.add(definition.id)
        let fiber: Fiber
        try { fiber = await this.ctx.plugin(plugin, source.config) } finally { this.restoring.delete(definition.id) }
        this.recovered.set(definition.id, fiber)
        void this.engine.remove(definition.id).then(() => this.flush()).catch(() => {
          // A failed retirement retains its code and handlers for an explicit retry.
          this.ctx.logger.error(`task.retirement.blocked ${JSON.stringify({ definitionId: definition.id })}`)
        })
      } catch {
        this.ctx.logger.error(`task.retirement.code-unavailable ${JSON.stringify({ definitionId: definition.id })}`)
      }
    }
  }

  /** Release restored plugin fibers after initial or retried retirement completes.
   * @returns completion of the shared disposal pass; failed fibers remain eligible for retry.
   */
  flush(): Promise<void> {
    this.releasing ??= this.releaseCompleted().finally(() => { this.releasing = undefined })
    return this.releasing
  }

  private async releaseCompleted(): Promise<void> {
    for (const [id, fiber] of this.recovered) {
      if (this.db.retirement(id)?.state !== 'complete') continue
      await fiber.dispose()
      this.recovered.delete(id)
    }
  }
}
