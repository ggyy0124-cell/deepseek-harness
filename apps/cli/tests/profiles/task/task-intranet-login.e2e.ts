/** Intranet access: the shipped Task profile listens on all interfaces, accepts its trusted host and signs in the fixed account. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { taskProfileLaunch } from './launch.ts'

const repository = fileURLToPath(new URL('../../../../../', import.meta.url))

/** Send one request with an explicit Host header, which fetch cannot set. */
function send(port: number, path: string, headers: Record<string, string>, body?: unknown) {
  const text = body === undefined ? undefined : JSON.stringify(body)
  return new Promise<{ status: number; cookie: string | undefined; body: Record<string, unknown> }>((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path: `/api/task/v1/${path}`, method: text === undefined ? 'GET' : 'POST',
      headers: { ...headers, ...(text === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) }) } },
    (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      response.once('error', reject)
      response.once('end', () => {
        resolve({ status: response.statusCode!, cookie: response.headers['set-cookie']?.[0],
          body: JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown> })
      })
    })
    request.once('error', reject)
    request.end(text)
  })
}

describe('Task intranet password login', () => {
  it.each(['src', 'lib'] as const)('%s: stores the password, serves trusted hosts and signs in the fixed account', async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-task-intranet-'))
    const home = join(directory, '.dsh')
    const env = { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-no-model-call' }
    const run = (args: string[], input?: string) => {
      const launch = taskProfileLaunch(args, mode)
      return execa(launch.command, launch.args, { cwd: repository, env: { ...launch.env, ...env }, timeout: 45000, reject: false,
        ...(input === undefined ? {} : { input }) })
    }
    const patch = join(directory, 'intranet.patch.yml')
    await writeFile(patch, [
      '- id: task-local',
      '  config:',
      `    path: ${JSON.stringify(join(directory, 'tasks.sqlite'))}`,
      `    resourceRoot: ${JSON.stringify(join(directory, 'resources'))}`,
      '- id: task-api-gateway',
      '  config:',
      `    attachmentRoot: ${JSON.stringify(join(directory, 'attachments'))}`,
      '    trustedHosts: !!js ctx.taskStartup.trustedHosts',
      '    passwordLogin:',
      '      enabled: true',
      '      username: operator',
      '',
    ].join('\n'))
    let diagnostics = ''
    try {
      expect((await run(['--password-set'], '\n')).exitCode).not.toBe(0)
      const stored = await run(['--password-set'], 'secret-pass\n')
      expect(stored.exitCode, stored.stderr).toBe(0)
      expect(JSON.parse(stored.stdout.split('\n').find(line => line.startsWith('{"reference":')) ?? '{}'))
        .toEqual({ reference: 'TASK_WEB_PASSWORD', configured: true })
      expect(stored.stdout + stored.stderr).not.toContain('secret-pass')
      const wrongHost = await run(['--host', '10.0.0.5', '--port', '0'])
      expect(wrongHost.exitCode).not.toBe(0)
      expect(wrongHost.stderr).toContain('host 127.0.0.1 or 0.0.0.0')

      const launch = taskProfileLaunch(['--patch', patch, '--host', '0.0.0.0', '--trusted-host', 'tasks.lan', '--port', '0'], mode)
      const child = execa(launch.command, launch.args, { cwd: repository, env: { ...launch.env, ...env }, timeout: 45000,
        killSignal: 'SIGKILL', reject: false })
      child.stdout.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
      try {
        let port = 0
        await expect.poll(() => {
          port = Number(/dsh task Web: http:\/\/127\.0\.0\.1:(\d+)\//.exec(diagnostics)?.[1] ?? 0)
          return port
        }, { timeout: 30000 }).toBeGreaterThan(0).catch((error: unknown) => { throw new Error(diagnostics, { cause: error }) })
        expect(diagnostics).toContain(`dsh task Web: http://tasks.lan:${port}/`)
        const lan = { Host: `tasks.lan:${port}`, Origin: `http://tasks.lan:${port}` }
        expect(await send(port, 'auth/methods', { Host: lan.Host })).toMatchObject({ status: 200, body: { password: true } })
        expect(await send(port, 'auth/methods', { Host: `other.lan:${port}` })).toMatchObject({ status: 403 })
        expect(await send(port, 'auth/login', lan, { username: 'operator', password: 'wrong' })).toMatchObject({ status: 401 })
        const signedIn = await send(port, 'auth/login', lan, { username: 'operator', password: 'secret-pass' })
        expect(signedIn.status).toBe(200)
        const cookie = signedIn.cookie?.split(';')[0] ?? ''
        expect(await send(port, 'definitions', { Host: lan.Host, Cookie: cookie })).toMatchObject({ status: 200 })
        const linked = await run(['--launch-link', '--port', String(port)])
        expect(linked.exitCode, linked.stderr).toBe(0)
        expect(linked.stdout).toMatch(new RegExp(`"url":"http://127\\.0\\.0\\.1:${port}/#launch=`))
        expect(diagnostics).not.toContain('secret-pass')
      } finally {
        child.kill('SIGTERM')
        await child
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('refuses to listen on all interfaces without a trusted host', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-task-intranet-'))
    try {
      const launch = taskProfileLaunch(['--host', '0.0.0.0', '--port', '0'], 'src')
      const result = await execa(launch.command, launch.args, { cwd: repository, timeout: 45000, killSignal: 'SIGKILL', reject: false,
        env: { ...launch.env, DSH_HOME: join(directory, '.dsh'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-no-model-call' } })
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout + result.stderr).toContain('--trusted-host')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
