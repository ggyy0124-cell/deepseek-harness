/** Notification replay acknowledges delivery and drains its provider before closure. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TaskDatabase } from '../src/database.ts'
import { TaskNotifications } from '../src/notifications.ts'

describe('task notifications', () => {
  it('maintains independent durable cursors for registered destinations', async () => {
    const db = new TaskDatabase(':memory:')
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    const a = new TaskNotifications(db, { deliver: first }, 10, 'one')
    const b = new TaskNotifications(db, { deliver: second }, 10, 'two')
    try {
      db.log(null, 'run.ended', 1, {})
      await a.flush(); await b.flush(); await a.flush(); await b.flush()
      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(1)
    } finally { await a.close(); await b.close(); db.close() }
  })
  it('preserves delivery acknowledgement across database reopen', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-notifications-'))
    const path = join(root, 'tasks.sqlite')
    const deliver = vi.fn(() => Promise.resolve())
    let db = new TaskDatabase(path)
    let notifications = new TaskNotifications(db, { deliver }, 10)
    try {
      db.log(null, 'stage.waiting', 1, {})
      await notifications.flush()
      await notifications.close()
      db.close()
      db = new TaskDatabase(path)
      notifications = new TaskNotifications(db, { deliver }, 10)
      await notifications.flush()
      expect(deliver).toHaveBeenCalledTimes(1)
      db.log(null, 'run.ended', 2, {})
      await notifications.flush()
      expect(deliver).toHaveBeenCalledTimes(2)
    } finally { await notifications.close(); db.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('retries the same identity and skips acknowledged records after consumer restart', async () => {
    const db = new TaskDatabase(':memory:')
    const deliver = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const first = new TaskNotifications(db, { deliver }, 2)
    let second: TaskNotifications | undefined
    try {
      db.log(null, 'host.started', 1, {})
      db.log(null, 'stage.blocked', 2, { secret: 'never delivered' })
      await expect(first.flush()).rejects.toThrow('offline')
      expect(db.notificationCursor()).toBe(1)
      await first.flush()
      expect(deliver.mock.calls[0]?.slice(0, 2)).toEqual(deliver.mock.calls[1]?.slice(0, 2))
      expect(deliver.mock.calls[1]?.[1]).not.toHaveProperty('details')
      await first.close()
      second = new TaskNotifications(db, { deliver }, 2)
      await second.flush()
      expect(deliver).toHaveBeenCalledTimes(2)
    } finally { await first.close(); await second?.close(); db.close() }
  })

  it('shares an in-flight page and waits for a cancelled provider to settle', async () => {
    const db = new TaskDatabase(':memory:')
    let settle: (() => void) | undefined
    const deliver = vi.fn(async (_store, _entry, signal: AbortSignal) => {
      await new Promise<void>((resolve) => { settle = resolve })
      signal.throwIfAborted()
    })
    const notifications = new TaskNotifications(db, { deliver }, 1)
    try {
      db.log(null, 'run.ended', 1, {})
      const pending = notifications.flush()
      const rejected = expect(pending).rejects.toThrow()
      expect(notifications.flush()).toBe(pending)
      let closed = false
      const closing = notifications.close().then(() => { closed = true })
      await Promise.resolve()
      expect(closed).toBe(false)
      settle?.()
      await closing
      await rejected
      await notifications.flush()
      expect(deliver).toHaveBeenCalledOnce()
      expect(db.notificationCursor()).toBe(0)
    } finally { settle?.(); await notifications.close(); db.close() }
  })
})
