/** Password-login failure budget per address and username. */
import { describe, expect, it } from 'vitest'
import { LoginThrottle } from '../src/login-throttle.ts'

function throttle() {
  let now = 1000
  const subject = new LoginThrottle({ maxFailures: 3, failureWindowMs: 100, lockoutMs: 500, clock: () => now })
  return { subject, advance: (ms: number) => { now += ms } }
}

describe('LoginThrottle', () => {
  it('locks a subject on the failure that exhausts its budget and releases it after the lockout', () => {
    const { subject, advance } = throttle()
    subject.fail(['address:a', 'username:u'])
    subject.fail(['address:a', 'username:u'])
    expect(subject.retryAfterMs(['address:a'])).toBe(0)
    subject.fail(['address:a', 'username:u'])
    expect(subject.retryAfterMs(['address:a'])).toBe(500)
    expect(subject.retryAfterMs(['address:b', 'username:u'])).toBe(500)
    expect(subject.retryAfterMs(['address:b', 'username:v'])).toBe(0)
    advance(499)
    expect(subject.retryAfterMs(['address:a'])).toBe(1)
    advance(1)
    expect(subject.retryAfterMs(['address:a', 'username:u'])).toBe(0)
    subject.fail(['address:a'])
    subject.fail(['address:a'])
    expect(subject.retryAfterMs(['address:a'])).toBe(0)
  })

  it('forgets failures outside the window and after a success', () => {
    const { subject, advance } = throttle()
    subject.fail(['address:a'])
    subject.fail(['address:a'])
    advance(100)
    subject.fail(['address:a'])
    subject.fail(['address:a'])
    expect(subject.retryAfterMs(['address:a'])).toBe(0)
    subject.clear(['address:a'])
    subject.fail(['address:a'])
    subject.fail(['address:a'])
    expect(subject.retryAfterMs(['address:a'])).toBe(0)
  })
})
