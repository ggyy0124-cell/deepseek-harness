/** Special-task-only model delegation consumer. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TaskRequestId } from '@deepseek-ai/dsh-task'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Cordis plugin name. */
export const name = 'tool-task-dispatch'
/** The execution owner installs dispatch tools into admitted special Session scopes. */
export const inject = ['tasks', 'tools']
/** Install the consumer; per-stage dispatch authority is supplied by the task provider.
 *
 * @param ctx - context carrying task execution and tool services.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    const run = ctx.tasks.forSession(agent.id)
    if (run === undefined || run.kind === 'ordinary') return
    ctx.effect(() => agent.ctx.tools.register(defineTool({
      name: 'task_dispatch',
      description: 'Dispatch one ordinary business task. Reuse request_id only when retrying the same dispatch. Existing unfinished work with the same business identity is associated and updated by the business plugin.',
      parameters: {
        request_id: { type: 'string', required: true, description: 'Stable dispatch retry identity within this special task.' },
        input_json: { type: 'string', required: true, description: 'Business input encoded as JSON; the owning plugin validates it.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          outcome: { type: 'string', required: true, enum: ['created', 'associated'] },
          runId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, changed: { type: 'boolean', required: true },
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined || exec.agent.id !== agent.id) throw new Error('task dispatch requires its owning special Agent')
        if (args.request_id.trim() === '') throw new Error('task dispatch request_id must not be empty')
        const input = JSON.parse(args.input_json) as JsonValue
        const receipt = await ctx.tasks.dispatch(agent.id, args.request_id as TaskRequestId, input)
        return { ...receipt }
      },
      presentCall: args => ({ card: 'generic', title: 'Dispatch business task', kind: 'other', rawInput: args }),
    })), `task-dispatch(${agent.id})`)
  })
}
