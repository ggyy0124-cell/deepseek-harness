/** Announce the Task API endpoint after the dsh application has started. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-task-api-gateway'
import type {} from '@deepseek-ai/dsh-cmdline'
/** Application runtime identity. */
export const name = 'task-app'
/** Host services reused without source changes. */
export const inject = ['webServer', 'taskGateway']
/** Publish the API address without creating a credential or serving a frontend.
 * @param ctx - application lifecycle owner.
 */
export function apply(ctx: Context): void {
  const ready = ctx.get('appReady')
  if (ready !== undefined) ctx.effect(() => ready.onReady(() => {
    process.stdout.write(`dsh task API: http://127.0.0.1:${ctx.webServer.port}/api/task/v1/\n`)
  }), 'task.ready')
}
