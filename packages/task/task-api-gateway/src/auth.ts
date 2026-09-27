/** Task-owned credentials; every authorization reads the current persisted grant. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TaskPrincipalId } from '@deepseek-ai/dsh-task'
import { z } from 'zod'
import type { TaskDeviceId } from './types.ts'

const key = credentialKey('task-api-gateway', 'authentication')
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const grantSchema = z.strictObject({
  version: z.literal(1),
  principal: z.uuid(),
  signingKey: secret,
  launches: z.array(z.strictObject({ digest: secret, expiresAt: z.number() })),
  sessions: z.array(z.strictObject({ id: z.uuid(), csrf: secret, expiresAt: z.number() })),
  devices: z.array(z.strictObject({ id: z.uuid(), digest: secret })),
})
type Grant = z.infer<typeof grantSchema>
/** Deployment limits for browser and device credentials. */
export interface AuthOptions {
  readonly launchTtlMs: number
  readonly sessionTtlMs: number
  readonly credentialLimit: number
  readonly clock: () => number
}
/** Authenticated local owner and the browser's required CSRF value. */
export interface TaskAuthentication {
  readonly principal: TaskPrincipalId
  readonly csrf: string | null
}
/** Rejection carries no submitted credential value. */
export class AuthenticationError extends Error {
  constructor() {
    super('Task authentication required')
    this.name = 'AuthenticationError'
  }
}
function token(): string {
  return randomBytes(32).toString('base64url')
}
function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
function parse(record: CredentialRecord | undefined): Grant {
  if (record?.kind !== 'grant') throw new Error('Task authentication grant is missing or incompatible')
  return grantSchema.parse(record.payload)
}
function signature(grant: Grant, id: string): string {
  return createHmac('sha256', grant.signingKey).update(id).digest('base64url')
}
/** Atomic credential updates prevent concurrent exchanges from consuming one launch twice. */
export class TaskAuthenticationStore {
  constructor(
    private readonly credentials: Pick<CredentialProvider, 'readRecord' | 'modifyRecord'>,
    private readonly options: AuthOptions,
  ) {}
  /** Create the owner identity once; incompatible existing records fail startup.
   * @returns completion after durable initialization.
   */
  async initialize(): Promise<void> {
    await this.credentials.modifyRecord(key, (current) => {
      if (current !== undefined) {
        parse(current)
        return Promise.resolve(undefined)
      }
      return Promise.resolve({
        kind: 'grant',
        payload: {
          version: 1,
          principal: randomUUID(),
          signingKey: token(),
          launches: [],
          sessions: [],
          devices: [],
        },
      })
    })
  }
  /** Issue a short-lived browser bootstrap secret for a local application launcher.
   * @returns the secret once; only its digest is stored.
   */
  async createLaunch(): Promise<string> {
    const value = token()
    await this.modify((grant) => {
      this.capacity(grant.launches.length)
      grant.launches.push({
        digest: digest(value),
        expiresAt: this.options.clock() + this.options.launchTtlMs,
      })
    })
    return value
  }
  /** Exchange a single-use launch for a signed browser cookie.
   * @param value - launch secret from the browser body, never a URL query.
   * @returns cookie value and browser CSRF token.
   */
  async exchange(value: string): Promise<{ cookie: string; csrf: string }> {
    let cookie = ''
    const csrf = token()
    const id = randomUUID()
    await this.modify((grant) => {
      const index = grant.launches.findIndex(entry => equal(entry.digest, digest(value)))
      if (index < 0) throw new AuthenticationError()
      this.capacity(grant.sessions.length)
      grant.launches.splice(index, 1)
      grant.sessions.push({ id, csrf, expiresAt: this.options.clock() + this.options.sessionTtlMs })
      cookie = `${id}.${signature(grant, id)}`
    })
    return { cookie, csrf }
  }
  /** Provision a native client credential through an authorized local caller.
   * @returns revocation identity and the secret once; no HTTP route exposes this method.
   */
  async createDevice(): Promise<{ id: TaskDeviceId; token: string }> {
    const id = brandString<TaskDeviceId>(randomUUID())
    const value = `${id}.${token()}`
    await this.modify((grant) => {
      this.capacity(grant.devices.length)
      grant.devices.push({ id, digest: digest(value) })
    })
    return { id, token: value }
  }
  /** Revoke an issued native credential; subsequent requests reread the grant.
   * @param id - device identity returned at provisioning.
   * @returns completion after durable revocation.
   */
  async revokeDevice(id: TaskDeviceId): Promise<void> {
    await this.modify((grant) => {
      grant.devices = grant.devices.filter(entry => entry.id !== id)
    })
  }
  /** Resolve exactly one cookie or bearer credential.
   * @param bearer - raw Authorization value if present.
   * @param cookie - Task cookie value if present.
   * @returns the authenticated owner; invalid or mixed credentials reject.
   */
  async authenticate(bearer: string | undefined, cookie: string | undefined): Promise<TaskAuthentication> {
    const credential = bearer ?? cookie
    if (credential === undefined || (bearer !== undefined && cookie !== undefined)) throw new AuthenticationError()
    const grant = parse(await this.credentials.readRecord(key))
    if (bearer !== undefined) {
      const value = /^Bearer ([A-Za-z0-9_.-]{80})$/.exec(credential)?.[1]
      if (
        value === undefined ||
        !grant.devices.some(entry => equal(entry.digest, digest(value)))
      )
        throw new AuthenticationError()
      return { principal: brandString<TaskPrincipalId>(grant.principal), csrf: null }
    }
    const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(credential)
    if (match?.[1] === undefined || match[2] === undefined || !equal(match[2], signature(grant, match[1])))
      throw new AuthenticationError()
    const session = grant.sessions.find(
      entry => entry.id === match[1] && entry.expiresAt > this.options.clock(),
    )
    if (session === undefined) throw new AuthenticationError()
    return { principal: brandString<TaskPrincipalId>(grant.principal), csrf: session.csrf }
  }
  /** Revoke an authenticated browser session.
   * @param cookie - signed cookie already authenticated by the gateway.
   */
  async logout(cookie: string): Promise<void> {
    const id = cookie.split('.')[0]
    await this.modify((grant) => {
      grant.sessions = grant.sessions.filter(value => value.id !== id)
    })
  }
  private capacity(length: number): void {
    if (length >= this.options.credentialLimit) throw new Error('Task credential capacity reached')
  }
  private async modify(change: (grant: Grant) => void): Promise<void> {
    await this.credentials.modifyRecord(key, (current) => {
      const grant = parse(current)
      const now = this.options.clock()
      grant.launches = grant.launches.filter(entry => entry.expiresAt > now)
      grant.sessions = grant.sessions.filter(entry => entry.expiresAt > now)
      change(grant)
      return Promise.resolve({ kind: 'grant', payload: grant })
    })
  }
}
