/** Fetch-based Task JSON API client with no Cordis runtime or browser plugin registration. */
import {
  attachmentSchema,
  problemSchema,
  taskCursorSchema,
  taskJsonRoutes,
  type SessionStreamEvent,
  type TaskStreamEvent,
  type TaskJsonRoute,
} from '@deepseek-ai/dsh-task-api-protocol'
import { z } from 'zod'
import { readSessionEvents, readTaskEvents } from './events.ts'

/** Operation identifiers projected directly from the protocol catalog. */
export type TaskOperationId = (typeof taskJsonRoutes)[number]['operationId']
/** Successful result inferred from the selected operation's runtime schema. */
export type TaskOperationResult<Operation extends TaskOperationId> = z.output<
  Extract<(typeof taskJsonRoutes)[number], { readonly operationId: Operation }>['response']
>

/** Validated HTTP failure; response bodies are not interpolated into diagnostic messages. */
export class TaskApiError extends Error {
  constructor(readonly problem: z.infer<typeof problemSchema>) {
    super(problem.detail)
    this.name = 'TaskApiError'
  }
}
/** Explicit caller configuration. Authentication values are sampled separately for each request. */
export interface TaskApiClientOptions {
  /** Maximum bytes in one received SSE frame; defaults to 262144. */
  readonly eventLimitBytes?: number
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
  readonly authentication: () => { readonly bearer: string } | { readonly csrf: string }
}
/** Wire arguments; callers keep one idempotency key across retries of the same command. */
export interface TaskApiRequest {
  readonly params?: Readonly<Record<string, string>>
  readonly query?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly idempotencyKey?: string
  readonly signal?: AbortSignal
}
/** Executes validated version 1 JSON operations without automatic write retries. */
export class TaskApiClient {
  private readonly base: URL
  private readonly eventLimitBytes: number
  constructor(private readonly options: TaskApiClientOptions) {
    this.eventLimitBytes = options.eventLimitBytes ?? 262144
    if (!Number.isSafeInteger(this.eventLimitBytes) || this.eventLimitBytes < 1)
      throw new Error('Invalid Task event byte limit')
    this.base = new URL(options.baseUrl)
    if (
      !['http:', 'https:'].includes(this.base.protocol) ||
      this.base.username !== '' ||
      this.base.password !== '' ||
      this.base.search !== '' ||
      this.base.hash !== ''
    ) {
      throw new Error('Task API base URL must be an HTTP URL without credentials, query, or fragment')
    }
    this.base.pathname = this.base.pathname.replace(/\/$/, '') + '/'
  }
  /** Read credential presence or replace its value; values are never returned.
   * @param reference - shared credential environment reference.
   * @param value - new value; omission performs a read.
   * @returns value-free presence and writability.
   */
  async credential(reference: string, value?: string): Promise<{ configured: boolean; writable: boolean }> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) throw new Error('Invalid credential reference')
    const auth = this.options.authentication()
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if ('bearer' in auth) headers.set('Authorization', `Bearer ${auth.bearer}`)
    else if (value !== undefined) headers.set('X-CSRF-Token', auth.csrf)
    const response = await this.options.fetch(new URL(`credentials/${reference}`, this.base), {
      method: value === undefined ? 'GET' : 'PUT',
      headers,
      credentials: 'bearer' in auth ? 'omit' : 'include',
      redirect: 'error',
      ...(value === undefined ? {} : { body: JSON.stringify({ value }) }),
    })
    if (!response.ok) await rejectResponse(response)
    const result: unknown = await response.json()
    if (
      result === null ||
      typeof result !== 'object' ||
      !('configured' in result) ||
      typeof result.configured !== 'boolean' ||
      !('writable' in result) ||
      typeof result.writable !== 'boolean'
    )
      throw new Error('Invalid credential status response')
    return { configured: result.configured, writable: result.writable }
  }
  /** List immutable files associated with an execution.
   * @param runId - owning execution.
   * @returns validated file metadata.
   */
  async attachments(runId: string): Promise<z.output<typeof attachmentSchema>[]> {
    const response = await this.attachmentRequest(runId)
    const value = (await response.json()) as { items?: unknown }
    return attachmentSchema.array().parse(value.items)
  }
  /** Upload files once; retain the same key and bytes to retry an uncertain response.
   * @param runId - active owning execution.
   * @param files - complete multipart files.
   * @param idempotencyKey - stable upload identity.
   * @returns durable attachment identities.
   */
  async upload(
    runId: string,
    files: readonly File[],
    idempotencyKey: string,
  ): Promise<z.output<typeof attachmentSchema>[]> {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(idempotencyKey)) throw new Error('Invalid upload retry identity')
    const body = new FormData()
    for (const file of files) body.append('files', file)
    const response = await this.attachmentRequest(runId, undefined, { body, idempotencyKey })
    const value = (await response.json()) as { items?: unknown }
    return attachmentSchema.array().parse(value.items)
  }
  /** Fetch a scoped attachment without exposing authentication in its URL.
   * @param runId - owning execution.
   * @param attachmentId - file identity returned by the gateway.
   * @returns downloaded bytes.
   */
  async download(runId: string, attachmentId: string): Promise<Blob> {
    return (await this.attachmentRequest(runId, attachmentId)).blob()
  }
  /** Download a visible Session attachment using its transcript position.
   * @param runId - owning execution.
   * @param sequence - original message event sequence.
   * @param index - image or file block position.
   * @returns verified attachment bytes.
   */
  async downloadSessionAttachment(runId: string, sequence: number, index: number): Promise<Blob> {
    const position = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    return (await this.fileRequest(`runs/${encodeURIComponent(runId)}/session-attachments/${position.parse(sequence)}/${position.parse(index)}`)).blob()
  }
  private async attachmentRequest(
    runId: string,
    attachmentId?: string,
    upload?: { body: FormData; idempotencyKey: string },
  ): Promise<Response> {
    const path = `runs/${encodeURIComponent(runId)}/attachments${attachmentId === undefined ? '' : `/${encodeURIComponent(attachmentId)}`}`
    return this.fileRequest(path, upload)
  }
  private async fileRequest(path: string, upload?: { body: FormData; idempotencyKey: string }): Promise<Response> {
    const auth = this.options.authentication()
    const headers = new Headers()
    if ('bearer' in auth) headers.set('Authorization', `Bearer ${auth.bearer}`)
    else if (upload !== undefined) headers.set('X-CSRF-Token', auth.csrf)
    if (upload !== undefined) headers.set('Idempotency-Key', upload.idempotencyKey)
    const response = await this.options.fetch(new URL(path, this.base), {
      method: upload === undefined ? 'GET' : 'POST',
      headers,
      credentials: 'bearer' in auth ? 'omit' : 'include',
      redirect: 'error',
      ...(upload === undefined ? {} : { body: upload.body }),
    })
    if (!response.ok) await rejectResponse(response)
    return response
  }
  /** Subscribe before fetching a REST baseline, or resume after a delivered cursor.
   * @param request - resume cursor and cancellation signal; abort cancels pending reads.
   * @returns ready and Task events. Reconnection is caller-owned; retain the last delivered cursor.
   */
  async *events(request: {
    readonly cursor?: string
    readonly signal: AbortSignal
  }): AsyncGenerator<TaskStreamEvent> {
    const url = new URL('events', this.base)
    if (request.cursor !== undefined) url.searchParams.set('cursor', taskCursorSchema.parse(request.cursor))
    const response = await this.openEvents(url, request.signal)
    yield* readTaskEvents(response, this.eventLimitBytes)
  }
  /** Subscribe to the owning Session's stored transcript.
   * @param request - Run, independent transcript cursor and cancellation.
   * @returns opening position and bounded transcript pages; reconnect using the last delivered cursor.
   */
  async *sessionEvents(request: {
    runId: string
    cursor?: string
    signal: AbortSignal
  }): AsyncGenerator<SessionStreamEvent> {
    const url = new URL(`runs/${encodeURIComponent(request.runId)}/events`, this.base)
    if (request.cursor !== undefined) url.searchParams.set('cursor', request.cursor)
    const response = await this.openEvents(url, request.signal)
    yield* readSessionEvents(response, this.eventLimitBytes)
  }
  private async openEvents(url: URL, signal: AbortSignal): Promise<Response> {
    const auth = this.options.authentication()
    const headers = new Headers({ Accept: 'text/event-stream' })
    if ('bearer' in auth) headers.set('Authorization', `Bearer ${auth.bearer}`)
    const response = await this.options.fetch(url, {
      headers,
      signal,
      redirect: 'error',
      credentials: 'bearer' in auth ? 'omit' : 'include',
    })
    if (!response.ok) await rejectResponse(response)
    if (
      response.status !== 200 ||
      response.headers.get('content-type')?.split(';')[0]?.trim() !== 'text/event-stream'
    ) {
      await response.body?.cancel()
      throw new Error('Task API returned an unexpected event response')
    }
    return response
  }
  /** Execute a declared operation and validate its response before returning it.
   * @param operationId - operation in the published route table.
   * @param request - parameters, body, cancellation, and stable command identity.
   * @returns the response validated by the operation schema.
   */
  async request<Operation extends TaskOperationId>(
    operationId: Operation,
    request: TaskApiRequest,
  ): Promise<TaskOperationResult<Operation>> {
    const route: TaskJsonRoute | undefined = taskJsonRoutes.find(value => value.operationId === operationId)
    /* v8 ignore next -- Operation is constrained by the exported TaskOperationId union. */
    if (route === undefined) throw new Error('Unknown Task API operation')
    const params = route.params?.parse(request.params) as Record<string, string> | undefined
    const query = route.query?.parse(request.query ?? {}) as Record<string, string> | undefined
    if (route.params === undefined && request.params !== undefined)
      throw new Error('Operation does not accept path parameters')
    if (route.query === undefined && request.query !== undefined)
      throw new Error('Operation does not accept query parameters')
    if (route.body === undefined && request.body !== undefined)
      throw new Error('Operation does not accept a body')
    const body = route.body?.parse(request.body)
    const path = route.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
      const value = params?.[name]
      /* v8 ignore next -- Route parameter schemas and templates are generated from the same catalog entry. */
      if (value === undefined) throw new Error('Task route parameter is undeclared')
      return encodeURIComponent(value)
    })
    const url = new URL(path.slice(1), this.base)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    const headers = new Headers({ Accept: 'application/json, application/problem+json' })
    const auth = this.options.authentication()
    if ('bearer' in auth) headers.set('Authorization', `Bearer ${auth.bearer}`)
    else if (route.method !== 'get') headers.set('X-CSRF-Token', auth.csrf)
    if (route.method !== 'get') {
      if (request.idempotencyKey === undefined || !/^[A-Za-z0-9._:-]{1,256}$/.test(request.idempotencyKey))
        throw new Error('Write request requires a valid Idempotency-Key')
      headers.set('Idempotency-Key', request.idempotencyKey)
    }
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const response = await this.options.fetch(url, {
      method: route.method.toUpperCase(),
      headers,
      credentials: 'bearer' in auth ? 'omit' : 'include',
      redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
    if (!response.ok) await rejectResponse(response)
    if (response.status !== route.status || contentType !== 'application/json')
      throw new Error('Task API returned an unexpected success response')
    return route.response.parse(await response.json()) as TaskOperationResult<Operation>
  }
}

/** Reject a transport failure without interpolating a non-protocol response body. */
async function rejectResponse(response: Response): Promise<never> {
  if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/problem+json') {
    await response.body?.cancel()
    throw new Error(`Task API returned an invalid error response (${response.status})`)
  }
  const problem = problemSchema.parse(await response.json())
  if (problem.status !== response.status) throw new Error('Task API problem status differs from HTTP status')
  throw new TaskApiError(problem)
}
