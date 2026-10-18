/** Task JSONL persistence authorization behavior. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import * as TaskJsonlSessionPersistence from '@deepseek-ai/dsh-task-session-persistence-jsonl'
import TaskSessionStore, { taskSessionStore } from '@deepseek-ai/dsh-task-session'
import { afterEach, describe, expect, it } from 'vitest'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

describe('TaskJsonlSessionPersistence', () => {
  it('allows reads while checking creation and write ownership', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-task-persistence-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const ctx = new Context()
    await ctx.plugin(TaskSessionStore)
    await ctx.plugin(TaskJsonlSessionPersistence, { root: directory, compression: 'none' })
    let allowed = true
    taskSessionStore(ctx).guardMutations(() => true, () => {
      if (!allowed) throw new Error('owner required')
    })
    const id = SessionId('owned')
    const writer = await ctx.sessionPersistence.create({
      id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false,
    })
    await writer.flush()
    await writer.close()
    await ctx.sessionPersistence.flush()
    expect((await ctx.sessionPersistence.list()).map(snapshot => snapshot.header.id)).toEqual([id])
    expect(await ctx.sessionPersistence.stat(id)).toBeDefined()

    allowed = false
    const reader = await ctx.sessionPersistence.open(id, 'read')
    await reader.close()
    await expect(ctx.sessionPersistence.open(id, 'write')).rejects.toThrow('owner required')
    await expect(ctx.sessionPersistence.create({
      id: SessionId('other'), version: SESSION_FORMAT_VERSION, createdAt: 2, isSeeded: false,
    })).rejects.toThrow('owner required')
    await ctx.fiber.dispose()
  })

  it('activates consumers that waited for persistence before the row mounted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-task-persistence-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const ctx = new Context()
    await ctx.plugin(TaskSessionStore)
    let active = false
    ctx.plugin({ inject: ['sessionPersistence'], apply() { active = true } })
    await ctx.plugin(TaskJsonlSessionPersistence, { root: directory, compression: 'none' })
    await expect.poll(() => active).toBe(true)
    await ctx.fiber.dispose()
  })

  it('keeps the shared backend open while consumers of the authorized provider unload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-task-persistence-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const ctx = new Context()
    await ctx.plugin(TaskSessionStore)
    const row = ctx.plugin(TaskJsonlSessionPersistence, { root: directory, compression: 'none' })
    await row
    taskSessionStore(ctx).guardMutations(() => true, () => {})
    const id = SessionId('kept')
    const writer = await ctx.sessionPersistence.create({ id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false })
    await writer.flush()
    await writer.close()
    let observed: number | undefined
    await ctx.plugin({
      inject: ['sessionPersistence'],
      apply(consumer: Context) {
        const persistence = consumer.sessionPersistence
        consumer.effect(() => async () => {
          const reader = await persistence.open(id, 'read')
          observed = (await reader.read()).events.length
          await reader.close()
        }, 'persistence consumer')
      },
    })
    await row.dispose()
    expect(observed).toBe(0)
    expect(ctx.get('sessionPersistence')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
