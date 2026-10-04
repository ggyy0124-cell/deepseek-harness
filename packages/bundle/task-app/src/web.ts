/** Task Web assets served on the Task gateway origin; the application entry registers them as the WebServer fallback. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}
const MISSING = new Set(['ENOENT', 'EISDIR', 'ENOTDIR'])
/** Page policy: same-origin scripts and API calls; inline styles for React style attributes; blob images for attachment previews. */
const INDEX_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-cache',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const

/** Locate the built Task Web client of this installation.
 * @returns absolute `dist` directory of `@deepseek-ai/dsh-task-web-frontend`.
 */
export function resolveTaskWebRoot(): string {
  return join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-task-web-frontend/package.json')), 'dist')
}

/** Answer one browser request that no API route matched.
 * Existing files are served directly; a browser navigation to any other path is a client route and receives `index.html`.
 * @param request - unmatched request.
 * @param response - owned response.
 * @param root - absolute built client directory.
 * @returns completion after the response ends.
 */
export async function serveTaskWeb(request: IncomingMessage, response: ServerResponse, root: string): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end()
    return
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(String(request.url), 'http://task.invalid').pathname)
  } catch {
    response.writeHead(400).end() // Malformed percent-encoding names no file.
    return
  }
  const target = resolve(normalize(join(root, pathname)))
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403).end()
    return
  }
  const index = join(root, 'index.html')
  // Identities such as `demo.defects` look like file names, so client routes are recognized by navigation, not by extension.
  const navigation = String(request.headers.accept).includes('text/html')
  const file = await readExisting(target === root ? index : target) ?? (navigation ? await readExisting(index) : undefined)
  if (file === undefined) {
    response.writeHead(404).end()
    return
  }
  const headers = extname(file.path) === '.html'
    ? INDEX_HEADERS
    : {
      'content-type': MIME[extname(file.path)] ?? 'application/octet-stream',
      // Vite fingerprints everything under assets/; other files keep their names across releases.
      'cache-control': file.path.startsWith(join(root, 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    }
  response.writeHead(200, { ...headers, 'content-length': file.body.byteLength })
  response.end(request.method === 'HEAD' ? undefined : file.body)
}

/** Read a regular file; absent files and directories yield undefined, other failures propagate. */
async function readExisting(path: string): Promise<{ path: string; body: Buffer } | undefined> {
  try {
    return { path, body: await readFile(path) }
  } catch (error) {
    if (!MISSING.has(String((error as NodeJS.ErrnoException).code))) throw error
    return undefined
  }
}
