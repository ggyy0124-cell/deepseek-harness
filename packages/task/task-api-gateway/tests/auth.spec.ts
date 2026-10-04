/** Credential lifetime, single-use exchange, and revocation behavior. */
import { describe, expect, it } from 'vitest'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { TaskAuthenticationStore } from '../src/auth.ts'

function setup() {
  let record: CredentialRecord | undefined
  let tail = Promise.resolve()
  let now = 1000
  const credentials: Pick<CredentialProvider, 'readRecord' | 'modifyRecord'> = {
    readRecord: async () => structuredClone(record),
    modifyRecord: async (_key, mutate) => {
      const result = tail.then(async () => {
        const next = await mutate(structuredClone(record))
        if (next !== undefined) record = structuredClone(next)
        return structuredClone(record)
      })
      tail = result.then(() => {}, () => {})
      return result
    },
  }
  const options = { clock: () => now, launchTtlMs: 60, sessionTtlMs: 300, credentialLimit: 2 }
  return { store: new TaskAuthenticationStore(credentials, options),
    reopen: () => new TaskAuthenticationStore(credentials, options), record: () => record, advance: (ms: number) => { now += ms } }
}
describe('Task authentication grant', () => {
  it('rejects authentication before a durable grant has been provisioned', async () => {
    const { store } = setup()
    await expect(store.authenticate('Bearer missing', undefined)).rejects.toThrow()
  })

  it('revokes only the selected browser session and reuses expired capacity', async () => {
    const { store, advance } = setup()
    await store.initialize()
    const first = await store.exchange((await store.createLaunch()).token)
    const second = await store.exchange((await store.createLaunch()).token)
    await store.logout(first.cookie)
    await expect(store.authenticate(undefined, first.cookie)).rejects.toThrow('authentication required')
    expect(await store.authenticate(undefined, second.cookie)).toMatchObject({ csrf: second.csrf })
    advance(301)
    const third = await store.exchange((await store.createLaunch()).token)
    expect(await store.authenticate(undefined, third.cookie)).toMatchObject({ csrf: third.csrf })
  })

  it('consumes a launch exactly once across concurrent exchanges', async () => {
    const { store, record } = setup()
    await store.initialize()
    const { token: launch } = await store.createLaunch()
    expect(JSON.stringify(record())).not.toContain(launch)
    const exchanges = await Promise.allSettled([store.exchange(launch), store.exchange(launch)])
    expect(exchanges.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect(exchanges.filter(value => value.status === 'rejected')).toHaveLength(1)
    const success = exchanges.find(value => value.status === 'fulfilled')
    if (success?.status !== 'fulfilled') throw new Error('missing successful exchange')
    expect(await store.authenticate(undefined, success.value.cookie)).toMatchObject({ csrf: success.value.csrf })
  })
  it('expires launches and browser sessions and rejects altered signatures', async () => {
    const { store, advance } = setup()
    await store.initialize()
    const { token: launch, expiresAt } = await store.createLaunch()
    expect(expiresAt).toBe(1060)
    advance(60)
    await expect(store.exchange(launch)).rejects.toThrow('authentication required')
    const session = await store.exchange((await store.createLaunch()).token)
    await expect(store.authenticate(undefined, `${session.cookie}x`)).rejects.toThrow('authentication required')
    const forged = session.cookie.slice(0, -1) + (session.cookie.endsWith('A') ? 'B' : 'A')
    await expect(store.authenticate(undefined, forged)).rejects.toThrow('authentication required')
    advance(300)
    await expect(store.authenticate(undefined, session.cookie)).rejects.toThrow('authentication required')
  })
  it('preserves owner identity through reopen and checks revocation on every request', async () => {
    const { store, reopen, record } = setup()
    await store.initialize()
    const device = await store.createDevice()
    expect(JSON.stringify(record())).not.toContain(device.token)
    const owner = await store.authenticate(`Bearer ${device.token}`, undefined)
    const second = reopen()
    await second.initialize()
    expect(await second.authenticate(`Bearer ${device.token}`, undefined)).toEqual(owner)
    await second.revokeDevice(device.id)
    await expect(store.authenticate(`Bearer ${device.token}`, undefined)).rejects.toThrow('authentication required')
  })
  it('rejects missing and mixed credentials and enforces bounded issuance', async () => {
    const { store } = setup()
    await store.initialize()
    await expect(store.authenticate(undefined, undefined)).rejects.toThrow('authentication required')
    const device = await store.createDevice()
    await store.createDevice()
    await expect(store.createDevice()).rejects.toThrow('capacity')
    await expect(store.authenticate(`Bearer ${device.token}`, 'cookie')).rejects.toThrow('authentication required')
    await expect(store.authenticate('Bearer invalid', undefined)).rejects.toThrow('authentication required')
    await store.revokeDevice(device.id)
    await expect(store.createDevice()).resolves.toHaveProperty('token')
  })
})
