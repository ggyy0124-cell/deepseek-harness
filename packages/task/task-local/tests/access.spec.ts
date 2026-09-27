/** Model admission expires even when a detached callback retains its async context. */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskSessionAccess } from '../src/access.ts'

describe('Task model admission', () => {
  it('revokes child creation after the model operation settles', async () => {
    const access = new TaskSessionAccess()
    const owner = brandString<SessionId>('owner')
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let detached!: Promise<ReturnType<TaskSessionAccess['modelOwner']>>
    await access.model(owner, 'analysis', async () => {
      expect(access.modelOwner()).toEqual({ owner, modelKey: 'analysis' })
      detached = gate.then(() => access.modelOwner())
    })
    release()
    expect(await detached).toBeUndefined()
  })
})
