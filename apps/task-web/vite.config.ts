/** Task Web build: a static single-page client served by the Task Profile at its gateway origin. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** Gateway that `vite` development serving proxies `/api/task/v1` to; the Task host binds 3081 by default. */
const gateway = process.env.DSH_TASK_WEB_GATEWAY ?? 'http://127.0.0.1:3081'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Absolute asset URLs: deep links such as /runs/<id> load the same index.
  base: '/',
  plugins: [react()],
  define: { __DSH_TASK_WEB_VERSION__: JSON.stringify(version) },
  // The explicit HTML entry also lets the third-party notice generator find the page.
  build: { target: 'es2022', sourcemap: true, rollupOptions: { input: { index: fileURLToPath(new URL('./index.html', import.meta.url)) } } },
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5180,
    strictPort: true,
    // The gateway checks Host and Origin; a rewritten origin keeps browser writes acceptable.
    proxy: { '/api/task/v1': { target: gateway, changeOrigin: true, headers: { origin: gateway } } },
  },
})
