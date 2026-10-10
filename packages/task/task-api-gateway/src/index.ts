/** Authenticated Task REST gateway, scoped to the Task Profile's shared HTTP server. */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-cmdline'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  TaskCommandError,
  type TaskConfig,
  type TaskDefinitionId,
  type TaskRequestId,
  type TaskRunId,
} from '@deepseek-ai/dsh-task'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { credentialReferences } from '@deepseek-ai/dsh-task/schema'
// Type-only: the shared `agentPresets` roster this gateway lists.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-permission-presets'
import {
  idSchema,
  authMethodsSchema,
  browserSessionSchema,
  configSchema,
  createTaskOpenApi,
  credentialListSchema,
  passwordLoginSchema,
  problemSchema,
  taskCursorSchema,
  taskJsonRoutes,
  type TaskJsonRoute,
} from '@deepseek-ai/dsh-task-api-protocol'
import { z } from 'zod'
import { TaskAttachments } from './attachments.ts'
import { AuthenticationError, matchesSecret, TaskAuthenticationStore } from './auth.ts'
import { LoginThrottle } from './login-throttle.ts'
import { HttpProblem, readJson, taskCookie, validate } from './http.ts'
import type { TaskDeviceId } from './types.ts'
export type { TaskDeviceId } from './types.ts'
import { streamSessionEvents } from './session-events.ts'
import { streamTaskEvents } from './events.ts'
import { readTaskTranscript } from './transcript.ts'
import { downloadSessionAttachment } from './session-attachments.ts'
import type {} from '@deepseek-ai/dsh-attachment'
import { executeOperation } from './operations.ts'
import { projectDiagnostics } from './projection.ts'

const prefix = '/api/task/v1'
const exchangeSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
/** `host` or `host:port`, where the host is a name, an IPv4 address or a bracketed IPv6 address. */
const authorityPattern = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/
/** Fixed-account browser password login. */
export interface PasswordLoginConfig {
  /** Offer `POST /auth/login`; disabled deployments accept only the launch link and device credentials. */
  readonly enabled: boolean
  /** The single accepted username; required when enabled. */
  readonly username: string
  /** Credential reference holding the password; `PUT /credentials/{reference}` refuses it. */
  readonly passwordRef: string
  /** Failures per client address or username inside one window before a lock. */
  readonly maxFailures: number
  /** Window in milliseconds over which failures count. */
  readonly failureWindowMs: number
  /** Lock length in milliseconds after the budget is exhausted. */
  readonly lockoutMs: number
}
/** Gateway deployment limits and browser origin. */
export interface Config {
  /** Private immutable blob and upload receipt directory. */
  readonly attachmentRoot: string
  /** Maximum bytes per file. */
  readonly attachmentFileLimitBytes: number
  /** Maximum complete multipart request bytes. */
  readonly attachmentUploadLimitBytes: number
  /** Multipart body deadline in milliseconds. */
  readonly attachmentUploadTimeoutMs: number
  /** Maximum files in one upload. */
  readonly attachmentFileLimit: number
  /** Exact browser origin; empty selects HTTP loopback and the bound server port. */
  readonly publicOrigin: string
  /**
   * Further authorities (`host` or `host:port`; a bare host means the bound port) whose origins pass the Host and Origin
   * checks, with the scheme of `publicOrigin` or `http`. Listening on all interfaces requires at least one.
   */
  readonly trustedHosts: string[]
  /** Browser password login for the fixed account. */
  readonly passwordLogin: PasswordLoginConfig
  /** Maximum bytes in one complete JSON request body. */
  readonly bodyLimitBytes: number
  /** Maximum bytes in one complete JSON response. */
  readonly responseLimitBytes: number
  /** Deadline in milliseconds for receiving a complete request body. */
  readonly bodyTimeoutMs: number
  /** Default number of runs returned per page, at most 200. */
  readonly pageSize: number
  /** JSON bytes of transcript messages after which one transcript window ends; a single larger message is delivered alone. */
  readonly transcriptPageBytes: number
  /** Deadline for plugin configuration checks and option discovery. */
  readonly configCheckTimeoutMs: number
  /** Single-use browser launch lifetime in milliseconds. */
  readonly launchTtlMs: number
  /** Signed browser session lifetime in milliseconds. */
  readonly sessionTtlMs: number
  /** Maximum live entries in each credential category. */
  readonly credentialLimit: number
  /** Durable journal poll interval per SSE connection in milliseconds. */
  readonly eventPollMs: number
  /** Heartbeat interval checked between replay batches, in milliseconds. */
  readonly eventHeartbeatMs: number
  /** Maximum journal records loaded per replay batch. */
  readonly eventBatchSize: number
  /** Maximum queued socket bytes, including complete event frames. */
  readonly eventBufferBytes: number
  /** Maximum wait for a slow SSE socket to drain in milliseconds. */
  readonly eventDrainTimeoutMs: number
  /** Maximum concurrent Task SSE connections. */
  readonly eventConnectionLimit: number
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    taskGateway: TaskApiGateway
  }
}
/** HTTP Consumer of Task and Credentials; business plugins contribute no routes. */
export class TaskApiGateway extends Service {
  static inject = [
    'attachments',
    'tasks',
    'credentials',
    'webServer',
    'sessionPersistence',
    'agentPresets',
    'permissionPresets',
    'llm',
  ]
  static Config: Schema<Config> = Schema.object({
    attachmentRoot: Schema.string().required(),
    attachmentFileLimitBytes: Schema.number().min(1).step(1).default(52428800),
    attachmentUploadLimitBytes: Schema.number().min(1).step(1).default(209715200),
    attachmentUploadTimeoutMs: Schema.number().min(1).step(1).default(120000),
    attachmentFileLimit: Schema.number().min(1).step(1).default(20),
    configCheckTimeoutMs: Schema.number().min(1).step(1).default(60000),
    publicOrigin: Schema.string().default(''),
    trustedHosts: Schema.array(String).default([]),
    passwordLogin: Schema.object({
      enabled: Schema.boolean().default(false),
      username: Schema.string().default(''),
      passwordRef: Schema.string().default('TASK_WEB_PASSWORD'),
      maxFailures: Schema.number().min(1).step(1).default(5),
      failureWindowMs: Schema.number().min(1).step(1).default(900000),
      lockoutMs: Schema.number().min(1).step(1).default(900000),
    }),
    bodyLimitBytes: Schema.number().min(1).step(1).default(1048576),
    responseLimitBytes: Schema.number().min(1024).step(1).default(4194304),
    bodyTimeoutMs: Schema.number().min(1).step(1).default(30000),
    pageSize: Schema.number().min(1).max(200).step(1).default(50),
    transcriptPageBytes: Schema.number().min(1024).step(1).default(131072),
    launchTtlMs: Schema.number().min(1).step(1).default(60000),
    eventPollMs: Schema.number().min(1).step(1).default(1000),
    eventHeartbeatMs: Schema.number().min(1).step(1).default(15000),
    eventBatchSize: Schema.number().min(1).max(1000).step(1).default(512),
    eventBufferBytes: Schema.number().min(1024).step(1).default(2097152),
    eventDrainTimeoutMs: Schema.number().min(1).step(1).default(15000),
    eventConnectionLimit: Schema.number().min(1).step(1).default(32),
    sessionTtlMs: Schema.number().min(1).step(1).default(2592000000),
    credentialLimit: Schema.number().min(1).step(1).default(100),
  })
  private readonly attachments: TaskAttachments
  private readonly authentication: TaskAuthenticationStore
  private readonly throttle: LoginThrottle
  private readonly passwordRef: CredentialRef
  private ready = false
  private stopping = false
  private streams = 0
  private readonly pending = new Map<Promise<void>, { request: IncomingMessage; response: ServerResponse }>()
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'taskGateway')
    this.attachments = new TaskAttachments({
      root: config.attachmentRoot,
      fileLimitBytes: config.attachmentFileLimitBytes,
      uploadLimitBytes: config.attachmentUploadLimitBytes,
      uploadTimeoutMs: config.attachmentUploadTimeoutMs,
      uploadFileLimit: config.attachmentFileLimit,
    })
    if (config.publicOrigin !== '') {
      const origin = new URL(config.publicOrigin)
      if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.publicOrigin)
        throw new Error('Task publicOrigin must be an HTTP origin')
    }
    for (const entry of config.trustedHosts)
      if (!authorityPattern.test(entry)) throw new Error(`Task trustedHosts entry ${JSON.stringify(entry)} must be host or host:port`)
    if (ctx.webServer.host !== '127.0.0.1' && config.trustedHosts.length === 0)
      throw new Error('Task listening on all interfaces requires trustedHosts (--trusted-host <authority>)')
    if (config.passwordLogin.enabled && config.passwordLogin.username.trim() === '')
      throw new Error('Task passwordLogin.username is required when password login is enabled')
    this.passwordRef = credentialRef(config.passwordLogin.passwordRef)
    this.throttle = new LoginThrottle({ ...config.passwordLogin, clock: Date.now })
    this.authentication = new TaskAuthenticationStore(ctx.credentials, { ...config, clock: Date.now })
  }
  protected async [Service.init](): Promise<void> {
    await this.authentication.initialize()
    const readiness = this.ctx.get('appReady')
    if (readiness === undefined) this.ready = true
    else
      this.ctx.effect(
        () =>
          readiness.onReady(() => {
            this.ready = true
          }),
        'task-api.ready',
      )
    this.ctx.effect(() => {
      const unregister = this.ctx.webServer.register({
        kind: 'prefix',
        path: prefix,
        handler: (request, response) => {
          const work = this.handle(request, response)
          this.pending.set(work, { request, response })
          void work.then(
            () => {
              this.pending.delete(work)
            },
            () => {
              this.pending.delete(work)
              response.destroy()
            },
          )
          return work
        },
      })
      return async () => {
        this.stopping = true
        unregister()
        for (const { request, response } of this.pending.values()) {
          request.destroy()
          response.destroy()
        }
        await Promise.allSettled([...this.pending.keys()])
      }
    }, 'task-api.routes')
  }
  /** Create a browser launch secret for an authorized local application entry.
   * @returns single-use secret and its expiry; the gateway never logs the secret.
   */
  createLaunchToken(): Promise<{ token: string; expiresAt: number }> {
    return this.authentication.createLaunch()
  }
  /** Provision a device through an authorized local caller.
   * @returns device revocation identity and its secret once.
   */
  createDeviceToken(): Promise<{ id: TaskDeviceId; token: string }> {
    return this.authentication.createDevice()
  }
  /** Revoke a previously provisioned native client.
   * @param id - device revocation identity.
   * @returns durable revocation completion.
   */
  revokeDeviceToken(id: TaskDeviceId): Promise<void> {
    return this.authentication.revokeDevice(id)
  }

  private assertRunning(): void {
    if (this.stopping) throw new HttpProblem(503, 'stopping', 'Task gateway is stopping')
  }
  /** Browser origins that pass the Host and Origin checks: the public or loopback origin first, then each trusted host.
   * @returns origins in configuration order.
   */
  browserOrigins(): URL[] {
    const port = this.ctx.webServer.port
    const primary = new URL(this.config.publicOrigin || `http://127.0.0.1:${port}`)
    return [primary, ...this.config.trustedHosts.map(entry =>
      new URL(`${primary.protocol}//${/\]:\d+$|^[^[]*:\d+$/.test(entry) ? entry : `${entry}:${port}`}`))]
  }
  /** Resolve the request's Host to one browser origin and check its Origin against that origin.
   * @returns the matched origin, which also decides request URL resolution and the cookie Secure attribute.
   */
  private checkOrigin(request: IncomingMessage, requireOrigin: boolean): URL {
    const origin = this.browserOrigins().find(candidate => candidate.host === request.headers.host)
    if (origin === undefined)
      throw new HttpProblem(403, 'host_rejected', 'Request Host is not the Task origin')
    if (
      (requireOrigin && request.headers.origin === undefined) ||
      (request.headers.origin !== undefined && request.headers.origin !== origin.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      throw new HttpProblem(403, 'origin_rejected', 'Request Origin is not the Task origin')
    }
    return origin
  }
  /** Verify the fixed account under the failure throttle.
   * @returns a new browser session; wrong values reject with an authentication error and count as failures.
   */
  private async passwordSession(request: IncomingMessage, response: ServerResponse,
    input: { username: string; password: string }): Promise<{ cookie: string; csrf: string; expiresAt: number }> {
    /* v8 ignore next -- A socket that is still delivering its request has a remote address; only a destroyed socket loses it. */
    const address = request.socket.remoteAddress ?? 'unknown'
    const keys = [`address:${address}`, `username:${input.username}`]
    const waitMs = this.throttle.retryAfterMs(keys)
    if (waitMs > 0) {
      response.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)))
      throw new HttpProblem(429, 'login_throttled', 'Too many failed sign-in attempts')
    }
    const stored = await this.ctx.credentials.resolve(this.passwordRef)
    if (stored === undefined)
      this.ctx.logger.warn(`task.api.login ${JSON.stringify({ outcome: 'password_unconfigured', reference: this.config.passwordLogin.passwordRef })}`)
    // Both comparisons always run so the response time does not reveal which value was wrong.
    const username = matchesSecret(input.username, this.config.passwordLogin.username)
    const password = matchesSecret(input.password, stored?.value ?? '')
    if (!username || !password || stored === undefined) {
      this.throttle.fail(keys)
      this.ctx.logger.info(`task.api.login ${JSON.stringify({ outcome: 'rejected', address })}`)
      throw new AuthenticationError()
    }
    this.throttle.clear(keys)
    this.ctx.logger.info(`task.api.login ${JSON.stringify({ outcome: 'accepted', address })}`)
    return this.authentication.openVerifiedSession()
  }
  /** Send a new browser session as its HttpOnly cookie and the CSRF body. */
  private sendBrowserSession(response: ServerResponse, origin: URL,
    session: { cookie: string; csrf: string; expiresAt: number }): void {
    response.setHeader(
      'Set-Cookie',
      `dsh_task_session=${session.cookie}; Path=/api/task/v1; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(this.config.sessionTtlMs / 1000)}${origin.protocol === 'https:' ? '; Secure' : ''}`,
    )
    this.send(response, 200, browserSessionSchema.parse({
      csrf: session.csrf, expiresAt: new Date(session.expiresAt).toISOString(),
    }))
  }
  private async transcript(
    response: ServerResponse,
    params: Record<string, string>,
    query: Record<string, string>,
  ): Promise<unknown> {
    const controller = new AbortController()
    const close = () => {
      controller.abort()
    }
    response.once('close', close)
    try {
      if (response.destroyed) controller.abort()
      return await readTaskTranscript(
        this.ctx.tasks,
        this.ctx.sessionPersistence,
        params['runId'] as string,
        query,
        this.config.pageSize,
        this.config.transcriptPageBytes,
        controller.signal,
      )
    } finally {
      response.off('close', close)
    }
  }

  /** Describe each credential reference named by an installed definition's current configuration.
   * @returns value-free status per reference, in reference order, with the naming definitions.
   */
  private async credentialList(): Promise<{ reference: string; configured: boolean; writable: boolean; definitionIds: string[] }[]> {
    const owners = new Map<string, string[]>()
    for (const definition of this.ctx.tasks.listDefinitions()) {
      if (!definition.installed || definition.forms === undefined) continue
      for (const reference of credentialReferences(definition.forms.business, definition.config.business))
        owners.set(reference, [...(owners.get(reference) ?? []), definition.id])
    }
    return Promise.all([...owners].sort(([left], [right]) => left.localeCompare(right)).map(async ([reference, definitionIds]) => {
      const info = await this.ctx.credentials.describe(credentialRef(reference))
      return { reference, configured: info.configured, writable: info.writable, definitionIds }
    }))
  }
  private async formOperation(
    operation: 'getCatalog' | 'checkConfig' | 'getOptions',
    params: Record<string, string>,
    body: unknown,
    response: ServerResponse,
  ): Promise<unknown> {
    if (operation === 'getCatalog')
      return {
        models: (
          await Promise.all(
            this.ctx.llm.listProviders().map(async (provider) => {
              try {
                return (await this.ctx.llm.listModels(provider.id)).map(model => ({
                  provider: provider.id,
                  model: model.id,
                  title: model.name,
                }))
              } catch {
                return []
              } // A provider with unavailable discovery contributes no selectable models.
            }),
          )
        ).flat(),
        presets: (await this.ctx.agentPresets.list()).map(item => ({
          id: item.id, title: item.name ?? item.id, description: item.description ?? null,
        })),
        permissions: this.ctx.permissionPresets.names.map(id => ({
          id,
          title: this.ctx.permissionPresets.optionOf(id).name,
        })),
      }
    const parsed = validate(z.object({ config: configSchema, field: z.string().optional() }), body)
    const { model, ...rest } = parsed.config
    const config: TaskConfig = model === undefined ? rest : { ...rest, model }
    const lifetime = new AbortController()
    const close = () => {
      lifetime.abort()
    }
    response.once('close', close)
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(this.config.configCheckTimeoutMs)])
    try {
      signal.throwIfAborted()
      const id = brandString<TaskDefinitionId>(params['definitionId'] as string)
      const result =
        operation === 'checkConfig'
          ? { messages: await this.ctx.tasks.checkConfig(id, config, signal) }
          : { items: await this.ctx.tasks.options(id, parsed.field as string, config, signal) }
      signal.throwIfAborted()
      return result
    } finally {
      response.off('close', close)
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID()
    const started = Date.now()
    let operation = 'unmatched'
    let status = 500
    let failureCode: string | null = null
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Request-Id', requestId)
    try {
      for (const name of [
        'authorization',
        'host',
        'origin',
        'idempotency-key',
        'x-csrf-token',
        'last-event-id',
      ]) {
        let count = 0
        for (let index = 0; index < request.rawHeaders.length; index += 2)
          if (request.rawHeaders[index]?.toLowerCase() === name) count++
        if (count > 1) throw new HttpProblem(400, 'duplicate_header', 'Request has an ambiguous header')
      }
      const requestOrigin = this.checkOrigin(request, false)
      /* v8 ignore next -- WebServer prefix routing only forwards origin-form targets below this path. */
      if (request.url === undefined || !request.url.startsWith('/') || request.url.startsWith('//'))
        throw new HttpProblem(400, 'invalid_target', 'Invalid request target')
      const url = new URL(request.url, requestOrigin)
      const path = url.pathname.slice(prefix.length)
      const method = request.method?.toLowerCase()
      const query: Record<string, string> = Object.create(null) as Record<string, string>
      for (const [key, value] of url.searchParams) {
        if (Object.hasOwn(query, key))
          throw new HttpProblem(400, 'duplicate_query', 'Query parameter is repeated')
        query[key] = value
      }
      const attachmentRoute = /^\/runs\/([^/]+)\/attachments(?:\/([^/]+))?$/.exec(path)
      const upload = attachmentRoute !== null && method === 'post' && attachmentRoute[2] === undefined
      const body = upload
        ? undefined
        : await readJson(request, this.config.bodyLimitBytes, this.config.bodyTimeoutMs)
      this.assertRunning()
      if (path === '/auth/exchange' && method === 'post') {
        operation = 'exchangeBrowserSession'
        const origin = this.checkOrigin(request, true)
        validate(z.strictObject({}), query)
        const input = validate(exchangeSchema, body)
        const session = await this.authentication.exchange(input.token)
        this.assertRunning()
        status = 200
        this.sendBrowserSession(response, origin, session)
        return
      }
      if (path === '/auth/methods' && method === 'get') {
        operation = 'getAuthMethods'
        validate(z.strictObject({}), query)
        if (body !== undefined) throw new HttpProblem(400, 'unexpected_body', 'This operation has no body')
        status = 200
        this.send(response, status, authMethodsSchema.parse({ password: this.config.passwordLogin.enabled }))
        return
      }
      if (path === '/auth/login' && method === 'post') {
        operation = 'loginBrowserSession'
        const origin = this.checkOrigin(request, true)
        validate(z.strictObject({}), query)
        if (!this.config.passwordLogin.enabled) throw new HttpProblem(404, 'route_not_found', 'Password login is disabled')
        const session = await this.passwordSession(request, response, validate(passwordLoginSchema, body))
        this.assertRunning()
        status = 200
        this.sendBrowserSession(response, origin, session)
        return
      }
      const auth = await this.authentication.authenticate(
        request.headers.authorization,
        taskCookie(request.headers.cookie),
      )
      this.assertRunning()
      if ((path === '/health' || path === '/ready') && method === 'get') {
        validate(z.strictObject({}), query)
        if (body !== undefined)
          throw new HttpProblem(400, 'unexpected_body', 'Health operations have no body')
        operation = path === '/health' ? 'health' : 'readiness'
        const ready = this.ready && (await this.ctx.tasks.diagnostics()).scheduler === 'running'
        status = path === '/ready' && !ready ? 503 : 200
        this.send(response, status, { ready, stopping: this.stopping })
        return
      }
      if (path === '/credentials') {
        validate(z.strictObject({}), query)
        if (method !== 'get' || body !== undefined)
          throw new HttpProblem(405, 'method_not_allowed', 'Credential listing supports reads only')
        operation = 'listCredentials'
        status = 200
        this.send(response, status, credentialListSchema.parse({ items: await this.credentialList() }))
        return
      }
      const credential = /^\/credentials\/([A-Za-z_][A-Za-z0-9_]*)$/.exec(path)
      if (credential !== null) {
        validate(z.strictObject({}), query)
        const ref = credentialRef(credential[1] as string)
        if (method === 'put') {
          operation = 'setCredential'
          if (auth.csrf !== null) {
            this.checkOrigin(request, true)
            if (request.headers['x-csrf-token'] !== auth.csrf)
              throw new HttpProblem(403, 'csrf_rejected', 'Task CSRF token does not match')
          }
          if (ref === this.passwordRef)
            throw new HttpProblem(403, 'credential_reserved', 'The sign-in password is set on the Task host with --password-set')
          const input = validate(z.strictObject({ value: z.string().min(1).max(65536) }), body)
          await this.ctx.credentials.set(ref, input.value)
        } else if (method !== 'get' || body !== undefined)
          throw new HttpProblem(405, 'method_not_allowed', 'Unsupported credential operation')
        else operation = 'describeCredential'
        const info = await this.ctx.credentials.describe(ref)
        status = 200
        this.send(response, status, { configured: info.configured, writable: info.writable })
        return
      }
      if (attachmentRoute !== null) {
        validate(z.strictObject({}), query)
        const runId = brandString<TaskRunId>(validate(idSchema, attachmentRoute[1]))
        const run = this.ctx.tasks.getRun(runId)
        if (run === undefined) throw new HttpProblem(404, 'not_found', 'Task run not found')
        if (upload) {
          operation = 'uploadAttachments'
          if (auth.csrf !== null) {
            this.checkOrigin(request, true)
            if (request.headers['x-csrf-token'] !== auth.csrf)
              throw new HttpProblem(403, 'csrf_rejected', 'Task CSRF token does not match')
          }
          const key = validate(
            z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/),
            request.headers['idempotency-key'],
          )
          const items = await this.attachments.upload(request, run, auth.principal, key, () => {
            this.assertRunning()
            const current = this.ctx.tasks.getRun(runId)
            if (current === undefined || current.terminalAt !== null || current.status === 'cancelling' || current.cleanup === 'blocked')
              throw new HttpProblem(409, 'run_readonly', 'Task run no longer accepts attachments')
          })
          status = 201
          this.send(response, status, { items })
          return
        }
        if (method !== 'get' || body !== undefined)
          throw new HttpProblem(405, 'method_not_allowed', 'Unsupported attachment operation')
        if (attachmentRoute[2] !== undefined) {
          operation = 'downloadAttachment'
          await this.attachments.download(run, validate(idSchema, attachmentRoute[2]), request, response)
          status = response.statusCode
          return
        }
        operation = 'listAttachments'
        status = 200
        this.send(response, status, { items: await this.attachments.list(run) })
        return
      }
      const sessionAttachment = /^\/runs\/([^/]+)\/session-attachments\/(\d+)\/(\d+)$/.exec(path)
      if (sessionAttachment !== null) {
        validate(z.strictObject({}), query)
        if (method !== 'get' || body !== undefined)
          throw new HttpProblem(405, 'method_not_allowed', 'Session attachments support downloads only')
        const runId = brandString<TaskRunId>(validate(idSchema, sessionAttachment[1]))
        const run = this.ctx.tasks.getRun(runId)
        if (run === undefined) throw new HttpProblem(404, 'not_found', 'Task run not found')
        operation = 'downloadSessionAttachment'
        const position = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
        await downloadSessionAttachment(this.ctx.sessionPersistence, this.ctx.attachments, run,
          validate(position, sessionAttachment[2]), validate(position, sessionAttachment[3]), response)
        status = response.statusCode
        return
      }
      const sessionStream = /^\/runs\/([^/]+)\/events$/.exec(path)
      if ((path === '/events' || sessionStream !== null) && method === 'get') {
        operation = sessionStream === null ? 'taskEvents' : 'sessionEvents'
        const input = validate(
          z.strictObject({
            cursor: sessionStream === null ? taskCursorSchema.optional() : z.string().max(2048).optional(),
          }),
          query,
        )
        if (body !== undefined) throw new HttpProblem(400, 'unexpected_body', 'This operation has no body')
        const header = request.headers['last-event-id']
        /* v8 ignore next -- duplicate raw headers are rejected above; Node exposes one surviving header as a string. */
        if (header !== undefined && typeof header !== 'string')
          throw new HttpProblem(400, 'invalid_cursor', 'Invalid event cursor header')
        if (input.cursor !== undefined && header !== undefined && input.cursor !== header) {
          throw new HttpProblem(400, 'ambiguous_cursor', 'Event cursor header and query differ')
        }
        if (this.streams >= this.config.eventConnectionLimit)
          throw new HttpProblem(503, 'stream_capacity', 'Task event connection limit reached')
        this.streams++
        try {
          status = 200
          const authorize = async () => {
            this.assertRunning()
            await this.authentication.authenticate(
              request.headers.authorization,
              taskCookie(request.headers.cookie),
            )
          }
          if (sessionStream === null)
            await streamTaskEvents(this.ctx.tasks, response, header ?? input.cursor, authorize, this.config)
          else
            await streamSessionEvents(
              this.ctx.tasks,
              this.ctx.sessionPersistence,
              validate(idSchema, sessionStream[1]),
              response,
              header ?? input.cursor,
              authorize,
              this.config,
            )
        } finally {
          this.streams--
        }
        return
      }
      if (path === '/auth/logout' && method === 'post') {
        operation = 'logoutBrowserSession'
        this.checkOrigin(request, true)
        validate(z.strictObject({}), query)
        if (body !== undefined || auth.csrf === null || request.headers['x-csrf-token'] !== auth.csrf)
          throw new HttpProblem(403, 'csrf_rejected', 'Invalid browser logout')
        await this.authentication.logout(taskCookie(request.headers.cookie) as string)
        response.setHeader(
          'Set-Cookie',
          'dsh_task_session=; Path=/api/task/v1; HttpOnly; SameSite=Strict; Max-Age=0',
        )
        status = 200
        this.send(response, status, { signedOut: true })
        return
      }
      if (path === '/auth/session' && method === 'get') {
        operation = 'getBrowserSession'
        validate(z.strictObject({}), query)
        if (body !== undefined) throw new HttpProblem(400, 'unexpected_body', 'This operation has no body')
        if (auth.csrf === null || auth.expiresAt === null) throw new AuthenticationError()
        status = 200
        this.send(response, status, browserSessionSchema.parse({ csrf: auth.csrf, expiresAt: new Date(auth.expiresAt).toISOString() }))
        return
      }
      if (path === '/openapi.json' && method === 'get') {
        operation = 'getOpenApi'
        validate(z.strictObject({}), query)
        if (body !== undefined) throw new HttpProblem(400, 'unexpected_body', 'This operation has no body')
        status = 200
        this.send(response, status, createTaskOpenApi())
        return
      }
      const matches = taskJsonRoutes.flatMap((candidate) => {
        const keys: string[] = []
        const pattern = candidate.path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
          keys.push(key)
          return '([^/]+)'
        })
        const match = new RegExp(`^${pattern}$`).exec(path)
        if (match === null) return []
        let params: Record<string, string>
        try {
          params = Object.fromEntries(
            keys.map((key, index) => [key, decodeURIComponent(match[index + 1] as string)]),
          )
        } catch {
          throw new HttpProblem(400, 'invalid_path', 'Invalid path encoding')
        }
        return [{ candidate, params }]
      })
      const match = matches.find(value => value.candidate.method === method)
      if (match === undefined)
        throw new HttpProblem(
          matches.length === 0 ? 404 : 405,
          'route_not_found',
          'Task operation not found for this path and method',
        )
      operation = match.candidate.operationId
      const route: TaskJsonRoute = match.candidate
      const params =
        route.params === undefined ? {} : (validate(route.params, match.params) as Record<string, string>)
      const validatedQuery =
        route.query === undefined
          ? validate(z.strictObject({}), query)
          : (validate(route.query, query) as Record<string, string>)
      if (route.body === undefined && body !== undefined)
        throw new HttpProblem(400, 'unexpected_body', 'This operation has no body')
      const validatedBody = route.body === undefined ? undefined : validate(route.body, body)
      let retryKey: string = requestId
      if (method !== 'get') {
        if (auth.csrf !== null) {
          this.checkOrigin(request, true)
          if (request.headers['x-csrf-token'] !== auth.csrf)
            throw new HttpProblem(403, 'csrf_rejected', 'Task CSRF token does not match')
        }
        retryKey = validate(z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/), request.headers['idempotency-key'])
      }
      const value =
        match.candidate.operationId === 'getDiagnostics'
          ? projectDiagnostics(await this.ctx.tasks.diagnostics())
          : match.candidate.operationId === 'getTranscript'
            ? await this.transcript(response, params, validatedQuery)
            : match.candidate.operationId === 'getCatalog' ||
              match.candidate.operationId === 'checkConfig' ||
              match.candidate.operationId === 'getOptions'
              ? await this.formOperation(match.candidate.operationId, params, validatedBody, response)
              : executeOperation(
                this.ctx.tasks,
                match.candidate.operationId,
                params,
                validatedQuery,
                validatedBody,
                auth.principal,
                brandString<TaskRequestId>(retryKey),
                this.config.pageSize,
              )
      this.assertRunning()
      const output = route.response.parse(value)
      status = route.status
      this.send(response, status, output)
    } catch (error) {
      let code = 'internal_error'
      let detail = 'Task request failed'
      let currentRevision: number | undefined
      status = 500
      if (error instanceof HttpProblem) {
        status = error.status
        code = error.code
        detail = error.message
      } else if (error instanceof AuthenticationError) {
        status = 401
        code = 'authentication_required'
        detail = error.message
      } else if (error instanceof TaskCommandError) {
        status =
          error.code === 'not_found'
            ? 404
            : error.code === 'unavailable'
              ? 503
              : error.code === 'invalid_configuration'
                ? 400
                : 409
        code = error.code
        detail = error.message
        currentRevision = error.currentRevision
      }
      failureCode = code
      const problem = problemSchema
        .strict()
        .parse({
          type: 'about:blank',
          status,
          title: 'Task API request rejected',
          detail,
          instance: `${prefix}/requests/${requestId}`,
          code,
          requestId,
          ...(currentRevision === undefined ? {} : { currentRevision }),
        })
      if (!response.destroyed && !response.headersSent) {
        response.setHeader('Connection', 'close')
        if (status === 401) response.setHeader('WWW-Authenticate', 'Bearer realm="task"')
        response.writeHead(status, { 'Content-Type': 'application/problem+json' })
        response.end(JSON.stringify(problem))
      } else response.destroy()
    } finally {
      try {
        this.ctx.logger.info(
          `task.api.request ${JSON.stringify({ requestId, operation, status: response.headersSent ? response.statusCode : status, failureCode, durationMs: Date.now() - started })}`,
        )
      } catch {
        /* Diagnostic exporter failures cannot invalidate an already committed command. */
      }
    }
  }
  private send(response: ServerResponse, status: number, value: unknown): void {
    const json = JSON.stringify(value)
    if (Buffer.byteLength(json) > this.config.responseLimitBytes)
      throw new HttpProblem(503, 'response_too_large', 'Response exceeds the configured limit')
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(json)
  }
}
export default TaskApiGateway
