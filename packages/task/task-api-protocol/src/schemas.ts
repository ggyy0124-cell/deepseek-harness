/** Public Task API records. These schemas contain no Host service or Session implementation types. */
import { z } from 'zod'
import { credentialReferencePattern, executionConfigSchema, taskIdPattern, taskQuestionSchema } from '@deepseek-ai/dsh-task/schema'

/** Opaque wire identity; consumers must not interpret its contents. */
export const idSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(taskIdPattern)
  .brand<'TaskApiId'>()
/** Persisted revision accepted for optimistic concurrency. */
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** UTC wire timestamp; storage adapters own conversion from internal timestamps. */
export const timestampSchema = z.iso.datetime()
/** Self-contained business schema; plugin registration owns compilation and resource limits. */
export const businessSchema = z.record(z.string(), z.json())
/** Credential status contains no resolved secret. */
export const credentialStatusSchema = z.object({
  reference: z.string().regex(credentialReferencePattern),
  configured: z.boolean(),
  writable: z.boolean(),
})
/** Credential references named by installed definitions' current configuration, with value-free status. */
export const credentialListSchema = z.object({
  items: z.array(credentialStatusSchema.extend({ definitionIds: z.array(idSchema) })),
})
/** Browser session returned by launch exchange and session recovery. */
export const browserSessionSchema = z.strictObject({ csrf: z.string(), expiresAt: timestampSchema })
/** Stable resource status values published by API version 1. */
export const statusSchema = z.enum([
  'provisioning',
  'queued',
  'running',
  'waiting_input',
  'waiting_retry',
  'blocked',
  'recovering',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
])
/** Execution configuration preserves references rather than secret values. */
export const configSchema = executionConfigSchema
/** Admission state of a definition; `blocked` means the scheduler disabled itself and `reason` says why. */
export const availabilitySchema = z.enum([
  'active', 'paused', 'blocked', 'retiring', 'retirement_blocked', 'unavailable', 'retired',
])
/** Read-only installed or historical business definition. */
export const definitionSchema = z.object({
  id: idSchema,
  title: z.string(),
  codeVersion: z.string(),
  configSchemaVersion: z.number().int().nonnegative(),
  revision: revisionSchema,
  installed: z.boolean(),
  enabled: z.boolean(),
  availability: availabilitySchema,
  reason: z.string().nullable(),
  config: configSchema,
  businessConfigSchema: businessSchema,
  manualInputSchema: businessSchema.nullable(),
  supplementalInputSchema: businessSchema.nullable(),
  nextDueAt: timestampSchema.nullable(),
})
/** Persisted human interaction with a version-bound reply. */
export const interactionSchema = z.object({
  id: idSchema,
  runId: idSchema,
  revision: revisionSchema,
  source: z.enum(['business', 'tool_approval', 'agent_question']),
  title: z.string(),
  /** Markdown body of a business wait; plain text for tool approvals and Agent questions. */
  description: z.string(),
  schema: businessSchema,
  /** Transcript tool call awaiting approval; null for business waits and questions. */
  callId: z.string().nullable(),
  /** Structured Agent questions; null for other sources. */
  questions: z.array(taskQuestionSchema).nullable(),
  /** Run attachments referenced by a business wait. */
  attachments: z.array(idSchema),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
})
/** Public execution record deliberately excludes private checkpoints and operation receipts. */
export const runSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  definitionId: idSchema,
  kind: z.enum(['manual', 'polling', 'scheduled', 'ordinary']),
  parentRunId: idSchema.nullable(),
  /** Failed or cancelled run this run restarted; null for every other run. */
  restartedFrom: idSchema.nullable(),
  businessKey: z.string().nullable(),
  codeVersion: z.string(),
  configRevision: revisionSchema,
  revision: revisionSchema,
  status: statusSchema,
  reason: z.string().nullable(),
  /** Terminal decision once settlement begins; it survives pending or blocked cleanup. */
  outcome: z.enum(['succeeded', 'failed', 'cancelled']).nullable(),
  /** Schedule instant of a polling or calendar run; `missed` covers coalesced occurrences. */
  occurrence: z.object({
    scheduledAt: timestampSchema,
    missed: z.object({ from: timestampSchema, through: timestampSchema, count: z.number().int().positive() }).nullable(),
  }).nullable(),
  cleanup: z.enum(['pending', 'blocked', 'complete']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  terminalAt: timestampSchema.nullable(),
  retryAt: timestampSchema.nullable(),
  result: z.json(),
  /** Supplemental input schema captured by this run; null accepts any JSON input. */
  supplementalInputSchema: businessSchema.nullable(),
})
/** Stable diagnostic response shared by every HTTP error. */
export const problemSchema = z.object({
  type: z.string().min(1),
  status: z.number().int().min(400).max(599),
  title: z.string(),
  detail: z.string(),
  instance: z.string(),
  code: z.string().min(1),
  requestId: idSchema,
  currentRevision: revisionSchema.optional(),
  errors: z.array(z.strictObject({ path: z.string(), code: z.string(), message: z.string() })).optional(),
})
/** Body accepted when replacing a business configuration. */
export const configureSchema = z.strictObject({
  revision: revisionSchema,
  configSchemaVersion: revisionSchema,
  config: configSchema,
})
/** Body accepted when enabling or pausing future triggers. */
export const enableSchema = z.strictObject({ revision: revisionSchema, enabled: z.boolean() })
/** Input submitted to a manual trigger or the durable supplemental inbox. */
export const inputSchema = z.strictObject({ input: z.json() })
/** One input a person gave a Run: supplemental information or a business-wait reply, in arrival order. */
export const runInputSchema = z.strictObject({
  revision: revisionSchema,
  kind: z.enum(['input', 'response']),
  at: timestampSchema,
  /** False while the input waits for a Task stage to consume it. */
  consumed: z.boolean(),
  value: z.json(),
})
/** Human response bound to the interaction revision observed by the client. */
export const responseSchema = z.strictObject({ revision: revisionSchema, response: z.json() })
/** Receipt acknowledges durable acceptance, not completion of cleanup. */
export const cancellationSchema = z.object({ runId: idSchema, status: z.literal('cancelling') })
/** Canonical decimal page size; parsers reject ambiguous or oversized query values. */
export const pageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/)
    .optional(),
})
const statusAlternatives = statusSchema.options.join('|')
/** Comma-separated current statuses; a run matches any listed status. */
export const statusListSchema = z.string().regex(new RegExp(`^(?:${statusAlternatives})(?:,(?:${statusAlternatives}))*$`))
/** Execution filters use exact business keys and UTC interval endpoints. */
export const runsQuerySchema = pageQuerySchema.extend({
  definitionId: idSchema.optional(),
  status: statusListSchema.optional(),
  parentRunId: idSchema.optional(),
  kind: z.enum(['manual', 'polling', 'scheduled', 'ordinary']).optional(),
  businessKey: z.string().min(1).max(1024).optional(),
  createdFrom: timestampSchema.optional(),
  createdTo: timestampSchema.optional(),
})
/** Cursor page has an explicit end marker. */
export const runsPageSchema = z.object({ items: z.array(runSchema), nextCursor: z.string().nullable() })
/** Full definition catalog includes uninstalled historical definitions. */
export const definitionsSchema = z.object({ items: z.array(definitionSchema) })

/** Replay cursor includes database identity to reject a cursor from another Task store. */
export const taskCursorSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(?:0|[1-9][0-9]{0,15})$/)
  .brand<'TaskEventCursor'>()
/** A ready event establishes the position before clients acquire their REST baseline. */
export const taskStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready'), cursor: taskCursorSchema }),
  z.object({
    kind: z.literal('task'),
    cursor: taskCursorSchema,
    event: z.string(),
    runId: idSchema.nullable(),
    at: timestampSchema,
  }),
])
/** Durable Task SSE event, independent of Cordis and Session implementation records. */
export type TaskStreamEvent = z.infer<typeof taskStreamEventSchema>

/** Public transcript blocks omit provider replay state, tool metadata and attachment storage paths. */
export const transcriptBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('reasoning'), text: z.string() }),
  z.object({ kind: z.literal('tool_call'), callId: z.string(), name: z.string(), arguments: z.string() }),
  z.object({ kind: z.literal('image'), name: z.string(), bytes: z.number().int().nonnegative(), mediaType: z.string() }),
  z.object({ kind: z.literal('file'), name: z.string(), bytes: z.number().int().nonnegative(), mediaType: z.string() }),
  z.object({ kind: z.literal('unsupported'), type: z.string() }),
])
/** Token counts of one model request; cached input is counted apart from `inputTokens`, and unreported counters are null. */
export const transcriptUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
})
const transcriptJsonSchema = z.record(z.string(), z.json())
/** One original transcript message; context replacements and internal events are excluded. */
export const transcriptEntrySchema = z.object({
  sequence: revisionSchema,
  at: timestampSchema,
  role: z.enum(['user', 'assistant', 'tool']),
  blocks: z.array(transcriptBlockSchema),
  callId: z.string().nullable(),
  isError: z.boolean(),
  /** Model that wrote an assistant message; null for the other roles. */
  model: z.string().nullable(),
  /** Token counts of the request behind an assistant message; null for the other roles and when the provider reported none. */
  usage: transcriptUsageSchema.nullable(),
  /** Loop turn that logged the message; null for a user message logged between turns. */
  turn: z.number().int().nonnegative().nullable(),
  /** Step of the turn that logged the message; null before the first step of a turn. */
  step: z.number().int().nonnegative().nullable(),
  /** Source of a user message: its `kind` and the fields that kind adds; null for assistant and tool messages. */
  source: transcriptJsonSchema.nullable(),
  /** Start of the model request (assistant message) or of the tool call (tool result); null for user messages and when the log lacks it. */
  startedAt: timestampSchema.nullable(),
  /** Arrival of the first streamed token of an assistant message; null for the other roles and when the stream recorded none. */
  firstTokenAt: timestampSchema.nullable(),
})
/** One tool declaration of a model request, as the model saw it. */
export const transcriptToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** JSON Schema of the tool arguments. */
  parameters: transcriptJsonSchema,
})
/** Request header the Session logged when it changed: it holds for every assistant message after it until the next header. */
export const transcriptRequestSchema = z.object({
  sequence: revisionSchema,
  at: timestampSchema,
  /** Why the header was logged, such as `initial` or `change`. */
  reason: z.string(),
  /** Provider, model and generation options. */
  config: transcriptJsonSchema,
  tools: z.array(transcriptToolSchema),
})
/** Forward event window; an empty page can advance over internal records. */
export const transcriptPageSchema = z.object({
  runId: idSchema,
  sessionId: idSchema,
  items: z.array(transcriptEntrySchema),
  requests: z.array(transcriptRequestSchema),
  nextCursor: z.string(),
  hasMore: z.boolean(),
})

/** Session feed events carry an independent transcript cursor and bounded durable message windows. */
export const sessionStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session_ready'), cursor: z.string().max(2048) }),
  z.object({ kind: z.literal('session'), cursor: z.string().max(2048), page: transcriptPageSchema }),
])
/** Public Session SSE event independent of shared Session implementation types. */
export type SessionStreamEvent = z.infer<typeof sessionStreamEventSchema>

/** Run-scoped immutable attachment metadata; no filesystem address is published. */
export const attachmentSchema = z.object({
  id: idSchema,
  runId: idSchema,
  sessionId: idSchema,
  name: z.string(),
  mime: z.string(),
  size: revisionSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: timestampSchema,
})

/** Uniform business output blocks; attachment identities resolve through the owning Run API. */
export const resultDocumentSchema = z.object({
  format: z.literal('task-result/v1'),
  blocks: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string() }),
    z.object({ kind: z.literal('markdown'), text: z.string() }),
    z.object({ kind: z.literal('json'), value: z.json() }),
    z.object({ kind: z.literal('code'), text: z.string(), language: z.string().optional() }),
    z.object({ kind: z.literal('diff'), text: z.string() }),
    z.object({ kind: z.literal('table'), columns: z.array(z.string()), rows: z.array(z.array(z.json())) }),
    z.object({ kind: z.enum(['image', 'file']), attachmentId: idSchema }),
  ])),
})
/** Durable plugin retirement; package removal is safe only after complete. */
export const retirementSchema = z.object({ id: idSchema, definitionId: idSchema, codeVersion: z.string(), state: z.enum(['pending','blocked','complete']),
  requestedAt: timestampSchema, completedAt: timestampSchema.nullable() })
/** Authenticated operating counters expose no business inputs or credential values. */
export const diagnosticsSchema = z.object({
  scheduler: z.enum(['starting', 'running', 'failed', 'stopping']), concurrency: z.number().int().positive(), activePermits: revisionSchema,
  totalRuns: revisionSchema, activeRuns: revisionSchema, completedRuns: revisionSchema, queuedRuns: revisionSchema,
  oldestQueuedAt: timestampSchema.nullable(), pendingInputs: revisionSchema, recoveryErrors: revisionSchema,
  cleanupFailures: revisionSchema, outboxPending: revisionSchema, oldestOutboxAt: timestampSchema.nullable(),
  resources: z.array(z.object({ name: z.string(), capacity: z.number().int().positive(), runIds: z.array(idSchema) })),
  retirements: z.array(retirementSchema),
  storage: z.object({ availableBytes: z.number().nonnegative(), totalBytes: z.number().nonnegative(), pressure: z.boolean() }).nullable(),
})
