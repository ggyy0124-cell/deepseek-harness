/** Serve the Task Web client and announce its address after the dsh application has started. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-task-api-gateway'
import type {} from '@deepseek-ai/dsh-cmdline'
import { resolveTaskWebRoot, serveTaskWeb } from './web.ts'
/** Application runtime identity. */
export const name = 'task-app'
/** Host services reused without source changes. */
export const inject = ['webServer', 'taskGateway']
/** Claim the WebServer fallback for the Task Web client and publish the Web and API addresses without creating a credential.
 * @param ctx - application lifecycle owner.
 */
export function apply(ctx: Context): void {
  const root = resolveTaskWebRoot()
  ctx.effect(() => ctx.webServer.registerFallback((request, response) => serveTaskWeb(request, response, root)), 'task-web.assets')
  const ready = ctx.get('appReady')
  if (ready !== undefined) ctx.effect(() => ready.onReady(() => {
    const origin = `http://127.0.0.1:${ctx.webServer.port}`
    const trusted = ctx.taskGateway.browserOrigins().slice(1).map(entry => `dsh task Web: ${entry.origin}/\n`).join('')
    process.stdout.write(`dsh task Web: ${origin}/ (sign in with dsh --profile task --launch-link)\n${trusted}dsh task API: ${origin}/api/task/v1/\n`)
  }), 'task.ready')
}
