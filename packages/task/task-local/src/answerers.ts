/** Task-only waterfall answerers; shared approval policy runs before these listeners. */
import type { Context } from '@deepseek-ai/cordis'
import type { TaskService } from '@deepseek-ai/dsh-task'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { z } from 'zod'
import type { RuntimeInteractions } from './interactions.ts'

/** Register answerers without claiming non-Task Agents.
 * @param ctx - provider lifecycle owner.
 * @param tasks - Session ownership lookup.
 * @param interactions - durable request owner.
 */
export function installTaskAnswerers(
  ctx: Context,
  tasks: TaskService,
  interactions: RuntimeInteractions,
): void {
  const lifetime = new AbortController()
  ctx.effect(
    () => () => {
      lifetime.abort()
    },
    'task.answerers',
  )
  ctx.on(
    'approval/request',
    async (request, next) => {
      const run = tasks.forSession(request.agent.id)
      if (run === undefined) return next()
      const answer = await interactions.ask(
        run.id,
        {
          source: 'tool_approval',
          title: request.toolName,
          description: request.reason ?? '',
          callId: request.callId ?? null,
          questions: null,
          expiresAt: null,
          schema: { type: 'string', enum: ['allowed-once', 'rejected'] },
        },
        request.signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, request.signal]),
      )
      return z.enum(['allowed-once', 'rejected']).parse(answer)
    },
    { global: true },
  )
  ctx.on(
    'user-questions/request',
    async (request, next) => {
      const run = request.agent === undefined ? undefined : tasks.forSession(request.agent.id)
      if (run === undefined) return next()
      const answer = await interactions.ask(
        run.id,
        {
          source: 'agent_question',
          title: request.questions.map(item => item.question).join('\n'),
          description: request.questions
            .map(item => item.detail ?? '')
            .filter(Boolean)
            .join('\n'),
          callId: null,
          questions: request.questions.map(item => ({
            id: item.id,
            question: item.question,
            detail: item.detail ?? null,
            header: item.header ?? null,
            multiSelect: item.multiSelect === true,
            options: (item.options ?? []).map(option => ({ label: option.label, description: option.description ?? null })),
          })),
          expiresAt: null,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['answers'],
            properties: {
              answers: {
                type: 'array',
                minItems: request.questions.length,
                maxItems: request.questions.length,
                prefixItems: request.questions.map(item => ({
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'selected'],
                  properties: {
                    id: { const: item.id },
                    selected: {
                      type: 'array',
                      uniqueItems: true,
                      ...(item.multiSelect === true ? {} : { maxItems: 1 }),
                      ...(item.options?.length ? {} : { maxItems: 0 }),
                      items: {
                        type: 'string',
                        ...(item.options?.length ? { enum: item.options.map(option => option.label) } : {}),
                      },
                    },
                    custom: { type: 'string' },
                  },
                })),
              },
            },
          },
        },
        request.signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, request.signal]),
      )
      return z
        .object({
          answers: z.array(
            z
              .object({ id: z.string(), selected: z.array(z.string()), custom: z.string().optional() })
              .transform(({ custom, ...item }) => (custom === undefined ? item : { ...item, custom })),
          ),
        })
        .parse(answer)
    },
    { global: true },
  )
}
