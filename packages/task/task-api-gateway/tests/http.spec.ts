/** HTTP parser bounds and failure responses through actual request streams. */
import { createServer, IncomingMessage, request } from 'node:http'
import { Socket } from 'node:net'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { HttpProblem, readBody, readJson, taskCookie, validate } from '../src/http.ts'

async function parseBody(body: string, headers: Record<string, string>, complete = true): Promise<{ status: number; value: unknown }> {
  const server = createServer((incoming, response) => {
    void (async () => {
      try { response.end(JSON.stringify({ value: await readJson(incoming, 32, 100) })) }
      catch (error) {
        response.setHeader('Connection', 'close')
        response.statusCode = error instanceof HttpProblem ? error.status : 500
        response.end(JSON.stringify({ code: error instanceof HttpProblem ? error.code : 'internal' }))
      }
    })()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    return await new Promise((resolve, reject) => {
      const outgoing = request({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, method: 'POST', headers }, (response) => {
        let value = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => { value += chunk })
        response.on('end', () => { resolve({ status: response.statusCode ?? 0, value: JSON.parse(value) as unknown }); outgoing.destroy() })
      })
      outgoing.on('error', reject)
      outgoing.write(body)
      if (complete) outgoing.end()
    })
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) }
}
describe('Task HTTP ingress', () => {
  it('rejects invalid wire fields without embedding their values in the error', () => {
    const schema = z.object({ revision: z.number().int() })
    expect(validate(schema, { revision: 1 })).toEqual({ revision: 1 })
    let failure: unknown
    try { validate(schema, { revision: 'private-secret' }) } catch (error) { failure = error }
    expect(failure).toMatchObject({ status: 400, code: 'invalid_request' })
    expect(String(failure)).not.toContain('private-secret')
  })
  it('accepts an empty body without a content type', async () => {
    expect(await parseBody('', {})).toEqual({ status: 200, value: {} })
  })

  it('rejects encoded multipart bodies and drops listeners on interrupted streams', async () => {
    const encoded = new IncomingMessage(new Socket())
    const interrupted = new IncomingMessage(new Socket())
    try {
      encoded.headers['content-encoding'] = 'gzip'
      expect(() => readBody(encoded, 32, 1000)).toThrow('Encoded request bodies')
      const pending = readBody(interrupted, 32, 1000)
      const rejected = expect(pending).rejects.toMatchObject({ status: 400, code: 'incomplete_body' })
      interrupted.emit('aborted')
      await rejected
      expect(interrupted.listenerCount('data')).toBe(0)
      expect(interrupted.listenerCount('aborted')).toBe(0)
    } finally { encoded.destroy(); interrupted.destroy() }
  })
  it('accepts JSON at the byte limit', async () => {
    expect(await parseBody(JSON.stringify('x'.repeat(30)), { 'Content-Type': 'application/json' })).toEqual({ status: 200, value: { value: 'x'.repeat(30) } })
  })
  it('counts UTF-8 bytes rather than characters', async () => {
    expect(await parseBody(JSON.stringify('中'.repeat(11)), { 'Content-Type': 'application/json' })).toMatchObject({ status: 413 })
  })
  it('rejects malformed JSON and unsupported content types without echoing the body', async () => {
    expect(await parseBody('private-invalid-json', { 'Content-Type': 'application/json' })).toEqual({ status: 400, value: { code: 'invalid_json' } })
    expect(await parseBody('{}', { 'Content-Type': 'text/plain' })).toMatchObject({ status: 415 })
    expect(await parseBody('{}', {})).toMatchObject({ status: 415 })
    expect(await parseBody('{}', { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })).toMatchObject({ status: 415 })
  })
  it('terminates incomplete requests at the configured body deadline', async () => {
    expect(await parseBody('{', { 'Content-Type': 'application/json', 'Content-Length': '10' }, false)).toMatchObject({ status: 408 })
  })
  it('accepts unrelated cookies but rejects duplicate Task credentials', () => {
    expect(taskCookie(undefined)).toBeUndefined()
    expect(taskCookie('other=a; dsh_task_session=value')).toBe('value')
    expect(taskCookie('other=a')).toBeUndefined()
    expect(() => taskCookie('dsh_task_session=a; dsh_task_session=b')).toThrow('Duplicate')
  })
})
