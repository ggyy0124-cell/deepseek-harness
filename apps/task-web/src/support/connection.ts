/** Browser connection to the Task gateway: launch exchange, cookie session, readiness and authenticated calls. */
import {
  TaskApiClient, TaskApiError, type TaskApiRequest, type TaskOperationId, type TaskOperationResult,
} from '@deepseek-ai/dsh-task-api-client'
import { browserSessionSchema, credentialListSchema, problemSchema } from '@deepseek-ai/dsh-task-api-protocol'
import type { CredentialStatus } from './types.ts'
import { Store } from './store.ts'

/** Why the browser has no usable session. */
export type SignedOutReason = 'link_invalid' | 'session_ended' | 'no_session'

/** Connection lifecycle shown by the login page and the application frame. */
export type ConnectionState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'exchanging' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'signed_out'; readonly reason: SignedOutReason }
  | { readonly kind: 'recovering'; readonly expiresAt: string }
  | { readonly kind: 'ready'; readonly expiresAt: string }

/** Problem returned by a rejected request, or a transport failure without one. */
export type RequestFailure =
  | { readonly kind: 'problem'
    readonly code: string
    readonly status: number
    readonly detail: string
    readonly currentRevision?: number | undefined
    readonly errors?: readonly { path: string; code: string; message: string }[] | undefined }
  | { readonly kind: 'transport'; readonly detail: string }

/** Read the public failure fields of an error thrown by a gateway call.
 * @param error - rejection from {@link TaskConnection} or the Task API client.
 * @returns problem fields, or a transport failure.
 */
export function describeFailure(error: unknown): RequestFailure {
  if (error instanceof TaskApiError) {
    return {
      kind: 'problem', code: error.problem.code, status: error.problem.status, detail: error.problem.detail,
      currentRevision: error.problem.currentRevision, errors: error.problem.errors,
    }
  }
  return { kind: 'transport', detail: error instanceof Error ? error.message : String(error) }
}

/** Whether an error is a gateway problem with one of the codes.
 * @param error - rejected call.
 * @param codes - accepted problem codes.
 * @returns true when the problem code matches.
 */
export function isProblem(error: unknown, ...codes: string[]): error is TaskApiError {
  return error instanceof TaskApiError && codes.includes(error.problem.code)
}

const READY_POLL_MS = 2000

/** Largest SSE frame the page accepts. A Session frame carries a whole transcript page, and one stored message can exceed the
 * gateway's page byte budget by itself.
 */
const EVENT_FRAME_LIMIT_BYTES = 4 * 1024 * 1024

/** Owns the CSRF secret of the cookie session and the state machine around it. */
export class TaskConnection {
  /** API base on the page origin; the gateway scopes its cookie to this path. */
  readonly base: URL
  readonly client: TaskApiClient
  readonly state = new Store<ConnectionState>({ kind: 'checking' })
  private csrf = ''
  private readyTimer: ReturnType<typeof setTimeout> | undefined

  /** @param documentBase - base URL of the served document; the API is resolved against it. */
  constructor(documentBase: string) {
    this.base = new URL('api/task/v1/', documentBase)
    this.client = new TaskApiClient({
      baseUrl: this.base.href,
      fetch: (input, init) => globalThis.fetch(input, init),
      authentication: () => ({ csrf: this.csrf }),
      eventLimitBytes: EVENT_FRAME_LIMIT_BYTES,
    })
  }

  /** Exchange a launch secret from the page fragment, or resume the cookie session.
   * @param fragment - `location.hash` of the first page load.
   * @returns completion after the state settles.
   */
  async start(fragment: string): Promise<void> {
    const launch = /^#launch=([A-Za-z0-9_-]{43})$/.exec(fragment)
    if (launch !== null) {
      this.state.set({ kind: 'exchanging' })
      try {
        const session = await this.post('auth/exchange', { token: launch[1] })
        this.accept(session)
        return
      } catch (error) {
        if (error instanceof TypeError) { this.state.set({ kind: 'unreachable' }); return }
        this.state.set({ kind: 'signed_out', reason: 'link_invalid' })
        return
      }
    }
    await this.resume('no_session')
  }

  /** Reread the cookie session; used after page load, CSRF rejection and service restarts.
   * @param reason - state reported when no session exists.
   * @returns completion after the state settles.
   */
  async resume(reason: SignedOutReason = 'session_ended'): Promise<void> {
    try {
      const response = await globalThis.fetch(new URL('auth/session', this.base), { credentials: 'include', redirect: 'error' })
      if (response.status === 401) { this.state.set({ kind: 'signed_out', reason }); return }
      if (!response.ok) throw new Error(`session read failed (${response.status})`)
      this.accept(browserSessionSchema.parse(await response.json()))
    } catch (error) {
      if (error instanceof TypeError) this.state.set({ kind: 'unreachable' })
      else throw error
    }
  }

  /** End the browser session on the gateway.
   * @returns completion after the cookie is cleared.
   */
  async logout(): Promise<void> {
    try {
      await this.post('auth/logout', undefined)
    } finally {
      this.csrf = ''
      this.state.set({ kind: 'signed_out', reason: 'no_session' })
    }
  }

  /** Execute a declared JSON operation; an expired session signs the page out.
   * @param operation - catalog operation.
   * @param request - parameters, body and idempotency key.
   * @returns validated response.
   */
  async call<Operation extends TaskOperationId>(operation: Operation,
    request: TaskApiRequest = {}): Promise<TaskOperationResult<Operation>> {
    return this.guard(() => this.client.request(operation, request))
  }

  /** List credential references named by installed definitions.
   * @returns value-free statuses.
   */
  credentials(): Promise<CredentialStatus[]> {
    return this.guard(async () => {
      const response = await globalThis.fetch(new URL('credentials', this.base), { credentials: 'include', redirect: 'error' })
      if (!response.ok) await reject(response)
      return credentialListSchema.parse(await response.json()).items
    })
  }

  /** Store a credential value; the response carries presence only.
   * @param reference - credential reference name.
   * @param value - secret value, never kept by the page.
   * @returns value-free presence.
   */
  setCredential(reference: string, value: string): Promise<{ configured: boolean; writable: boolean }> {
    return this.guard(() => this.client.credential(reference, value))
  }

  /** Read whether the scheduler finished recovery.
   * @returns readiness flag.
   */
  async readiness(): Promise<boolean> {
    const response = await globalThis.fetch(new URL('ready', this.base), { credentials: 'include', redirect: 'error' })
    if (response.status === 401) { this.signOut(); return false }
    return response.status === 200
  }

  /** Run an authenticated operation; CSRF rejection rereads the session and retries once.
   * @param action - gateway call.
   * @returns the call result.
   */
  async guard<Value>(action: () => Promise<Value>): Promise<Value> {
    try {
      return await action()
    } catch (error) {
      if (isProblem(error, 'authentication_required')) this.signOut()
      else if (isProblem(error, 'csrf_rejected')) {
        await this.resume()
        return action()
      }
      throw error
    }
  }

  private signOut(): void {
    const current = this.state.get()
    if (current.kind === 'ready' || current.kind === 'recovering') this.state.set({ kind: 'signed_out', reason: 'session_ended' })
  }

  private accept(session: { csrf: string; expiresAt: string }): void {
    this.csrf = session.csrf
    void this.waitReady(session.expiresAt)
  }

  private async waitReady(expiresAt: string): Promise<void> {
    clearTimeout(this.readyTimer)
    let ready = false
    try {
      ready = await this.readiness()
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
    }
    const current = this.state.get()
    if (current.kind === 'signed_out') return
    if (ready) { this.state.set({ kind: 'ready', expiresAt }); return }
    this.state.set({ kind: 'recovering', expiresAt })
    this.readyTimer = setTimeout(() => { void this.waitReady(expiresAt) }, READY_POLL_MS)
  }

  private async post(path: string, body: unknown): Promise<{ csrf: string; expiresAt: string }> {
    const headers = new Headers({ Accept: 'application/json' })
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    if (this.csrf !== '') headers.set('X-CSRF-Token', this.csrf)
    const response = await globalThis.fetch(new URL(path, this.base), {
      method: 'POST', headers, credentials: 'include', redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) await reject(response)
    const value: unknown = await response.json()
    return path === 'auth/logout' ? { csrf: '', expiresAt: '' } : browserSessionSchema.parse(value)
  }
}

/** Raise the gateway problem of a failed raw request. */
async function reject(response: Response): Promise<never> {
  if (response.headers.get('content-type')?.split(';')[0]?.trim() === 'application/problem+json')
    throw new TaskApiError(problemSchema.parse(await response.json()))
  throw new Error(`Task API returned ${response.status}`)
}

/** Fresh idempotency key for one user command; retries of the same command reuse it.
 * @returns opaque key accepted by the gateway.
 */
export function commandKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `web-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}
