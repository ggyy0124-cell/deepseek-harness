/** Recovery barriers decide timer ownership independently of host scheduling speed. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskScheduler } from '../src/scheduler.ts'

afterEach(() => { vi.useRealTimers() })

describe('Task scheduler readiness', () => {
  it('starts ticks only after recovery and stops them before closing', async () => {
    vi.useFakeTimers()
    const recovery = Promise.withResolvers<undefined>()
    const tick = vi.fn()
    const failure = vi.fn()
    const scheduler = new TaskScheduler(20, () => recovery.promise, tick, failure)
    try {
      const started = scheduler.start()
      expect(scheduler.start()).toBe(started)
      await vi.advanceTimersByTimeAsync(100)
      expect(scheduler.state).toBe('starting')
      expect(tick).not.toHaveBeenCalled()
      recovery.resolve(undefined); await started
      expect(scheduler.state).toBe('running')
      await vi.advanceTimersByTimeAsync(20)
      expect(tick).toHaveBeenCalledOnce()
      await scheduler.close()
      await vi.advanceTimersByTimeAsync(100)
      expect(tick).toHaveBeenCalledOnce()
      expect(scheduler.state).toBe('stopping')
      expect(failure).not.toHaveBeenCalled()
    } finally { recovery.resolve(undefined); await scheduler.close() }
  })

  it('awaits in-flight recovery without installing a timer after disposal', async () => {
    vi.useFakeTimers()
    const entered = Promise.withResolvers<undefined>()
    const recovery = Promise.withResolvers<undefined>()
    const tick = vi.fn()
    const scheduler = new TaskScheduler(20, () => { entered.resolve(undefined); return recovery.promise }, tick, vi.fn())
    let closed = false
    try {
      const started = scheduler.start()
      await entered.promise
      const closing = scheduler.close().then(() => { closed = true })
      await vi.advanceTimersByTimeAsync(100)
      expect(closed).toBe(false)
      expect(scheduler.state).toBe('stopping')
      recovery.resolve(undefined); await Promise.all([started, closing])
      await vi.advanceTimersByTimeAsync(100)
      expect(tick).not.toHaveBeenCalled()
      expect(closed).toBe(true)
    } finally { recovery.resolve(undefined); await scheduler.close() }
  })

  it('reports failed recovery and never admits ticks', async () => {
    vi.useFakeTimers()
    const failure = vi.fn()
    const tick = vi.fn()
    const scheduler = new TaskScheduler(20, () => Promise.reject(new Error('recovery')), tick, failure)
    try {
      await scheduler.start()
      expect(scheduler.state).toBe('failed')
      await vi.advanceTimersByTimeAsync(100)
      expect(tick).not.toHaveBeenCalled()
      expect(failure).toHaveBeenCalledWith('recovery')
    } finally { await scheduler.close() }
  })

  it('retains stopping state when an in-flight recovery fails during disposal', async () => {
    const entered = Promise.withResolvers<undefined>()
    const recovery = Promise.withResolvers<undefined>()
    const failure = vi.fn()
    const scheduler = new TaskScheduler(20, () => { entered.resolve(undefined); return recovery.promise }, vi.fn(), failure)
    try {
      const started = scheduler.start()
      await entered.promise
      const closing = scheduler.close()
      recovery.reject(new Error('interrupted recovery'))
      await Promise.all([started, closing])
      expect(scheduler.state).toBe('stopping')
      expect(failure).toHaveBeenCalledExactlyOnceWith('recovery')
    } finally { recovery.resolve(undefined); await scheduler.close() }
  })

  it('reports a failed tick while retaining the timer for subsequent work', async () => {
    vi.useFakeTimers()
    const failure = vi.fn()
    const tick = vi.fn().mockImplementationOnce(() => { throw new Error('storage') })
    const scheduler = new TaskScheduler(20, () => Promise.resolve(undefined), tick, failure)
    try {
      await scheduler.start()
      await vi.advanceTimersByTimeAsync(40)
      expect(tick).toHaveBeenCalledTimes(2)
      expect(failure).toHaveBeenCalledExactlyOnceWith('tick')
      expect(scheduler.state).toBe('running')
    } finally { await scheduler.close() }
  })

  it('does not begin recovery when disposed before start or before its first microtask', async () => {
    const recover = vi.fn(async () => {})
    const first = new TaskScheduler(20, recover, vi.fn(), vi.fn())
    await first.close(); await first.start()
    const second = new TaskScheduler(20, recover, vi.fn(), vi.fn())
    const started = second.start()
    await second.close(); await started
    expect(recover).not.toHaveBeenCalled()
  })
})
