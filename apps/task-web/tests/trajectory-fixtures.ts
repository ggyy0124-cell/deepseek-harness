/** Builders of stored messages, request headers and inputs shared by the trajectory specs. */
import { buildTrajectory } from '../src/support/trajectory.ts'
import type { RunInput, TranscriptBlock, TranscriptEntry, TranscriptRequest, TranscriptTool } from '../src/support/types.ts'

/** Time of a fixture event.
 * @param seconds - seconds after 2026-10-06T10:00:00Z; fractions give milliseconds.
 * @returns ISO timestamp.
 */
export const at = (seconds: number): string => new Date(Date.UTC(2026, 9, 6, 10, 0, 0) + seconds * 1000).toISOString()

/** Text block.
 * @param value - text.
 * @returns block.
 */
export const text = (value: string): TranscriptBlock => ({ kind: 'text', text: value })

/** Reasoning block.
 * @param value - reasoning text.
 * @returns block.
 */
export const reasoning = (value: string): TranscriptBlock => ({ kind: 'reasoning', text: value })

/** Tool call block.
 * @param callId - call id.
 * @param name - tool name.
 * @param args - arguments as the JSON text the model wrote.
 * @returns block.
 */
export const call = (callId: string, name = 'bash', args = '{"command":"ls"}'): TranscriptBlock => ({
  kind: 'tool_call', callId, name, arguments: args,
})

/** Token counters of one request.
 * @param inputTokens - uncached input tokens.
 * @param outputTokens - output tokens.
 * @param cacheReadTokens - cache reads; null when the provider reports none.
 * @param cacheWriteTokens - cache writes; null when the provider reports none.
 * @param reasoningTokens - reasoning tokens; null when the provider reports none.
 * @returns usage as stored on a message.
 */
export const usage = (
  inputTokens: number, outputTokens: number, cacheReadTokens: number | null = null, cacheWriteTokens: number | null = null,
  reasoningTokens: number | null = null,
): NonNullable<TranscriptEntry['usage']> => ({
  inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens,
})

/** Stored message.
 * @param sequence - position in the session log.
 * @param role - message role.
 * @param seconds - time the message was stored.
 * @param blocks - content blocks.
 * @param patch - fields that replace the defaults (no call id, no usage, no turn or step).
 * @returns message.
 */
export function message(sequence: number, role: TranscriptEntry['role'], seconds: number, blocks: TranscriptBlock[],
  patch: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    sequence, at: at(seconds), role, blocks, callId: null, isError: false, model: role === 'assistant' ? 'model-a' : null, usage: null, turn: null,
    step: null, source: null, startedAt: null, firstTokenAt: null, ...patch,
  }
}

/** Input a person gave the Run.
 * @param revision - input revision.
 * @param seconds - time the input arrived.
 * @param value - input value.
 * @param kind - `input` for supplemental input, `response` for a reply to a confirmation.
 * @returns input.
 */
export function given(revision: number, seconds: number, value: RunInput['value'], kind: RunInput['kind'] = 'input'): RunInput {
  return { revision, kind, at: at(seconds), consumed: true, value }
}

/** Tool declaration.
 * @param name - tool name.
 * @param description - what the tool does.
 * @returns declaration with one string parameter.
 */
export const tool = (name: string, description = `${name} tool`): TranscriptTool => ({
  name, description, parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
})

/** Request header.
 * @param sequence - log sequence of the header; it applies to the assistant messages stored after it.
 * @param tools - tool declarations in force.
 * @param config - provider and model options.
 * @returns header.
 */
export const header = (sequence: number, tools: TranscriptTool[] = [], config: TranscriptRequest['config'] = { provider: 'deepseek', model: 'model-a' }):
TranscriptRequest => ({ sequence, at: at(0), reason: 'initial', config, tools })

/** Two turns: a request that calls `read_file` (fails) and `bash` in parallel, a second request whose `bash` call has no result, a
 * supplemental input between the turns and a final answer. */
export const sampleEntries: TranscriptEntry[] = [
  message(1, 'user', 0, [text('Check the deploy logs\nsecond line')], { turn: 1, source: { kind: 'task' } }),
  message(2, 'assistant', 4, [reasoning('Maybe the cache is stale'), text('Looking now'), call('a', 'read_file', '{"path":"/var/log/deploy.log"}'), call('b')], {
    turn: 1, step: 1, usage: usage(100, 20, 50, 5, 8), startedAt: at(1), firstTokenAt: at(2),
  }),
  message(3, 'tool', 6, [text('ERROR connection refused')], { turn: 1, step: 1, callId: 'a', isError: true, startedAt: at(4.5) }),
  message(4, 'tool', 9, [text('{"ok":true}')], { turn: 1, step: 1, callId: 'b', startedAt: at(4.5) }),
  message(5, 'assistant', 12, [call('c')], { turn: 1, step: 2, usage: usage(10, 5), startedAt: at(9.5), firstTokenAt: at(10) }),
  message(6, 'user', 40, [text('stage two')], { turn: 2, source: { kind: 'task' } }),
  message(7, 'assistant', 45, [text('All done')], { turn: 2, step: 1, usage: usage(12, 3), startedAt: at(41), firstTokenAt: at(42) }),
]

/** Inputs of the sample Run. */
export const sampleInputs: RunInput[] = [given(1, 20, 'please also check disk')]

/** Request headers of the sample Run. */
export const sampleRequests: TranscriptRequest[] = [header(0, [tool('read_file'), tool('bash')])]

/** Trajectory of the sample Run; record ids are `m1`, `m2`, `m2:2`, `m2:3`, `m5`, `m5:0`, `i1`, `m6`, `m7`. */
export const sampleTrajectory = buildTrajectory(sampleEntries, sampleInputs, sampleRequests)
