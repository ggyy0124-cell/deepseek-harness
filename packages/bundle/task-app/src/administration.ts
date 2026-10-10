/** Local credential and inactive-store maintenance commands through dsh --profile task. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-cmdline'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { TaskAuthenticationStore } from '@deepseek-ai/dsh-task-api-gateway/auth-store'
import { backupTaskStore, restoreTaskStore } from '@deepseek-ai/dsh-task-local/maintenance'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TaskDeviceId } from '@deepseek-ai/dsh-task-api-gateway'
import type {} from './startup.ts'
/** Administrative command consumer. */
export const name = 'task-administration'
/** Required local providers; no HTTP server or engine is started. */
export const inject = ['taskStartup', 'credentials']
/** Local administrative deployment values. */
export interface Config {
  /** Isolated Task data directory. */
  root: string
  /** Browser launch lifetime, shared with gateway provisioning. */
  launchTtlMs: number
  /** Exact browser origin of launch links; empty selects HTTP loopback on the --port value. Must match the gateway's publicOrigin. */
  publicOrigin: string
  /** Browser session lifetime. */
  sessionTtlMs: number
  /** Maximum stored credentials per category. */
  credentialLimit: number
  /** Credential reference written by --password-set. Must match the gateway's passwordLogin.passwordRef. */
  passwordRef: string
}
/** Validate command deployment settings. */
export const Config: Schema<Config> = Schema.object({
  root: Schema.string().required(),
  launchTtlMs: Schema.number().min(1).default(60000),
  publicOrigin: Schema.string().default(''),
  sessionTtlMs: Schema.number().min(1).default(2592000000),
  credentialLimit: Schema.number().min(1).step(1).default(100),
  passwordRef: Schema.string().default('TASK_WEB_PASSWORD'),
})
/** Longest password the gateway's login body accepts. */
const PASSWORD_LIMIT = 1024
/** Read one line from a terminal without echoing it.
 * @param input - interactive standard input.
 * @param output - terminal stream for the prompt.
 * @param label - prompt text.
 * @returns the typed line; Ctrl-C rejects.
 */
function readHiddenLine(input: NodeJS.ReadStream, output: NodeJS.WriteStream, label: string): Promise<string> {
  output.write(label)
  input.setRawMode(true)
  input.setEncoding('utf8')
  input.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = (error?: Error) => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      output.write('\n')
      if (error === undefined) resolve(value)
      else reject(error)
    }
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') { finish(); return }
        if (character === '\u0003') { finish(new Error('password entry cancelled')); return }
        if (character === '\u007f' || character === '\b') value = Array.from(value).slice(0, -1).join('')
        else if (character >= ' ') value += character
      }
    }
    input.on('data', onData)
  })
}
/** Read the new sign-in password: twice without echo from a terminal, otherwise all of standard input minus one final newline.
 * @returns the non-empty password.
 */
async function readPassword(): Promise<string> {
  let value: string
  if (process.stdin.isTTY) {
    value = await readHiddenLine(process.stdin, process.stderr, 'Task Web password: ')
    if (value !== await readHiddenLine(process.stdin, process.stderr, 'Repeat the password: '))
      throw new Error('the two passwords differ')
  } else {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer))
    value = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  }
  if (value === '') throw new Error('the password is empty')
  if (value.length > PASSWORD_LIMIT) throw new Error(`the password exceeds ${PASSWORD_LIMIT} characters`)
  return value
}
/** Run one administration action only after successful loader startup.
 * @param ctx - command lifecycle owner.
 * @param config - explicit Task data root and credential policy.
 */
export function apply(ctx: Context, config: Config): void {
  const ready = ctx.get('appReady')
  if (ready === undefined) throw new Error('Task administration requires the dsh launcher')
  if (config.publicOrigin !== '') {
    const origin = new URL(config.publicOrigin)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.publicOrigin)
      throw new Error('Task publicOrigin must be an HTTP origin')
  }
  const passwordRef = credentialRef(config.passwordRef)
  ctx.effect(
    () => {
      let pending: Promise<void> | undefined
      const cancel = ready.onReady(() => {
        const perform = async () => {
          const { command, target } = ctx.taskStartup
          if (command === 'backup') await backupTaskStore(config.root, target)
          else if (command === 'restore') await restoreTaskStore(target, config.root)
          else if (command === 'password-set') {
            await ctx.credentials.set(passwordRef, await readPassword())
            process.stdout.write(`${JSON.stringify({ reference: config.passwordRef, configured: true })}\n`)
          } else {
            const store = new TaskAuthenticationStore(ctx.credentials, {
              launchTtlMs: config.launchTtlMs, sessionTtlMs: config.sessionTtlMs,
              credentialLimit: config.credentialLimit, clock: Date.now,
            })
            await store.initialize()
            if (command === 'token-create')
              process.stdout.write(`${JSON.stringify(await store.createDevice())}\n`)
            else if (command === 'token-revoke') await store.revokeDevice(brandString<TaskDeviceId>(target))
            else if (command === 'launch-link') {
              // Loopback reaches the host whether it listens on loopback or on all interfaces.
              const origin = config.publicOrigin === '' ? `http://127.0.0.1:${ctx.taskStartup.port}` : config.publicOrigin
              const launch = await store.createLaunch()
              // The fragment never reaches HTTP requests or server logs; the client posts it to /auth/exchange.
              process.stdout.write(`${JSON.stringify({ url: `${origin}/#launch=${launch.token}`, expiresAt: new Date(launch.expiresAt).toISOString() })}\n`)
            }
          }
          ctx.get('appExit')?.(0)
        }
        pending = perform().catch((error: unknown) => {
          process.stderr.write(
            `Task administration failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
          )
          ctx.get('appExit')?.(1)
        })
      })
      return async () => { cancel(); await pending }
    },
    'task.administration',
  )
}
