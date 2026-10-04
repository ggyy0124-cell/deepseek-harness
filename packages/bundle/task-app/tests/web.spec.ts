/** Task Web asset serving: client routes, fingerprinted assets, traversal and method handling. */
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveTaskWebRoot, serveTaskWeb } from '../src/web.ts'

interface Reply { status: number; headers: IncomingMessage['headers']; body: string }

let root: string
let server: Server
let failure: unknown
let serving: string

function send(method: string, path: string, accept = 'text/html,application/xhtml+xml'): Promise<Reply> {
  const { port } = server.address() as AddressInfo
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, method, path, headers: { accept } }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => { resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body }) })
    })
    request.on('error', reject)
    request.end()
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-task-web-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Task</title>')
  await writeFile(join(root, 'assets', 'index-abc123.js'), 'export {}')
  await writeFile(join(root, 'favicon.svg'), '<svg/>')
  await writeFile(join(root, 'data.bin'), 'bytes')
  failure = undefined
  serving = root
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    serveTaskWeb(request, response, serving).catch((error: unknown) => { failure = error; response.writeHead(500).end() })
  })
  await new Promise<void>((resolvePromise) => { server.listen(0, '127.0.0.1', resolvePromise) })
})

afterEach(async () => {
  await new Promise<void>((resolvePromise) => { server.close(() => { resolvePromise() }) })
  await rm(root, { recursive: true, force: true })
})

describe('serveTaskWeb', () => {
  it('serves the index with a restrictive page policy at the root and at client routes', async () => {
    for (const path of ['/', '/runs/run-1', '/definitions/zentao.defects?tab=runs', '/assets']) {
      const reply = await send('GET', path)
      expect(reply.status).toBe(200)
      expect(reply.body).toContain('<title>Task</title>')
      expect(reply.headers['content-type']).toBe('text/html; charset=utf-8')
      expect(reply.headers['cache-control']).toBe('no-cache')
      expect(reply.headers['content-security-policy']).toContain("script-src 'self'")
      expect(reply.headers['referrer-policy']).toBe('no-referrer')
    }
  })

  it('serves fingerprinted assets as immutable and other files without long caching', async () => {
    const asset = await send('GET', '/assets/index-abc123.js')
    expect(asset).toMatchObject({ status: 200, body: 'export {}' })
    expect(asset.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const icon = await send('GET', '/favicon.svg')
    expect(icon.headers['content-type']).toBe('image/svg+xml')
    expect(icon.headers['cache-control']).toBe('no-cache')
    const unknown = await send('GET', '/data.bin')
    expect(unknown.headers['content-type']).toBe('application/octet-stream')
    const html = await send('GET', '/index.html')
    expect(html.headers['content-security-policy']).toContain("frame-ancestors 'none'")
  })

  it('answers HEAD without a body', async () => {
    const reply = await send('HEAD', '/assets/index-abc123.js')
    expect(reply.status).toBe(200)
    expect(reply.headers['content-length']).toBe('9')
    expect(reply.body).toBe('')
  })

  it('returns 404 for missing files requested by scripts and for client routes when the client is not built', async () => {
    expect((await send('GET', '/assets/missing.js', '*/*')).status).toBe(404)
    expect((await send('GET', '/definitions/demo.defects', '*/*')).status).toBe(404)
    await rm(join(root, 'index.html'))
    expect((await send('GET', '/runs')).status).toBe(404)
    expect((await send('GET', '/')).status).toBe(404)
  })

  it('rejects writes, traversal and malformed encodings', async () => {
    const write = await send('POST', '/')
    expect(write.status).toBe(405)
    expect(write.headers['allow']).toBe('GET, HEAD')
    expect((await send('GET', '/%2e%2e%2fsecret.txt')).status).toBe(403)
    expect((await send('GET', '/%E0%A4%A')).status).toBe(400)
  })

  it('reports filesystem failures other than a missing file', async () => {
    await mkdir(join(root, 'locked.js'))
    expect((await send('GET', '/locked.js', '*/*')).status).toBe(404)
    serving = join(root, 'invalid\0root')
    expect((await send('GET', '/x.js')).status).toBe(500)
    expect(failure).toBeInstanceOf(Error)
  })
})

describe('resolveTaskWebRoot', () => {
  it('resolves the built client inside the frontend package', () => {
    expect(resolveTaskWebRoot()).toMatch(/task-web[/\\]dist$/)
  })
})
