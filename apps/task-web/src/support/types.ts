/** Public Task API records used by the Web client, inferred from the protocol catalog. */
import type { TaskOperationResult } from '@deepseek-ai/dsh-task-api-client'
import type { attachmentSchema, resultDocumentSchema, transcriptEntrySchema, taskStreamEventSchema } from '@deepseek-ai/dsh-task-api-protocol'
import type { z } from 'zod'

/** One execution as published by `GET /runs/{runId}`. */
export type Run = TaskOperationResult<'getRun'>
/** Current lifecycle value of a Run. */
export type RunStatus = Run['status']
/** Trigger category of a Run. */
export type RunKind = Run['kind']
/** One installed or historical business definition. */
export type Definition = TaskOperationResult<'getDefinition'>
/** Admission state of a definition. */
export type Availability = Definition['availability']
/** Execution configuration stored on a definition. */
export type TaskConfig = Definition['config']
/** Schedule part of an execution configuration. */
export type Schedule = TaskConfig['schedule']
/** Waiting business reply, tool approval or Agent question. */
export type Interaction = TaskOperationResult<'listWaitingInteractions'>['items'][number]
/** Value-free operating counters. */
export type Diagnostics = TaskOperationResult<'getDiagnostics'>
/** Presets, permission presets and models selectable for a definition. */
export type Catalog = TaskOperationResult<'getCatalog'>
/** Plugin retirement record. */
export type Retirement = TaskOperationResult<'getRetirement'>
/** One stored transcript message. */
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>
/** One block of a transcript message. */
export type TranscriptBlock = TranscriptEntry['blocks'][number]
/** Run attachment metadata. */
export type Attachment = z.infer<typeof attachmentSchema>
/** Structured business result. */
export type ResultDocument = z.infer<typeof resultDocumentSchema>
/** Durable Task event or the opening ready marker. */
export type TaskStreamEvent = z.infer<typeof taskStreamEventSchema>
/** Durable Task journal notification. */
export type TaskJournalEvent = Extract<TaskStreamEvent, { kind: 'task' }>
/** JSON value accepted by inputs, responses and configuration. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
/** Value-free credential status. */
export interface CredentialStatus {
  readonly reference: string
  readonly configured: boolean
  readonly writable: boolean
  readonly definitionIds: readonly string[]
}

/** Statuses that end a Run. */
export const TERMINAL_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled']
/** Every Run status in display order. */
export const RUN_STATUSES: readonly RunStatus[] = [
  'provisioning', 'queued', 'running', 'waiting_input', 'waiting_retry', 'blocked',
  'recovering', 'cancelling', 'succeeded', 'failed', 'cancelled',
]
/** Every Run kind in display order. */
export const RUN_KINDS: readonly RunKind[] = ['manual', 'polling', 'scheduled', 'ordinary']

/** Whether a Run has ended.
 * @param run - execution snapshot.
 * @returns true once the Run records its terminal time.
 */
export function isTerminal(run: Pick<Run, 'terminalAt'>): boolean {
  return run.terminalAt !== null
}

/** Whether a Run still accepts supplemental input, replies and uploads.
 * @param run - execution snapshot.
 * @returns false for ended, cancelling and cleanup-only Runs.
 */
export function acceptsInput(run: Pick<Run, 'terminalAt' | 'status' | 'cleanup' | 'outcome'>): boolean {
  return run.terminalAt === null && run.status !== 'cancelling' && run.cleanup !== 'blocked' && run.outcome === null
}
