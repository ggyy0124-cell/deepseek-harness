# `@deepseek-ai/dsh-task-web-frontend`

English | [中文](README.zh.md)

The Task Web client is the browser console of the Task Profile. It implements the [Task Web prototype](../../design/task-web/README.md) over the [Task REST gateway](../../packages/task/task-api-gateway/README.md) and is served by the Task host on the gateway origin, so `dsh --profile task` serves both `/` and `/api/task/v1/`.

## Use the client

Start the host with `dsh --profile task` and print a sign-in link with `dsh --profile task --launch-link` in another terminal. Opening the printed `http://127.0.0.1:3081/#launch=…` link exchanges its single-use secret at `/auth/exchange`, removes it from the address bar and keeps an HttpOnly cookie session; the client sends the session's CSRF secret on every write. A tab that already shows the client also accepts a newly pasted link. When no session exists, the page shows the sign-in command; a used or expired link, an ended session, an unreachable host and a recovering scheduler each show their own state.

| Page | Path | Operations |
|---|---|---|
| Overview | `/` | attention counters, recent runs, upcoming triggers and execution permits |
| Tasks | `/definitions` | enable or pause definitions; trigger manual tasks |
| Task | `/definitions/{id}` | schedule, execution and business configuration (generated form or JSON), plugin checks, dynamic options, revision conflicts, runs and retirement |
| Runs | `/runs` | status, kind, task, business-key and creation-time filters with cursor pages |
| Run | `/runs/{id}` | live transcript, replies, result documents, attachments, related runs, cancellation, cleanup retry and supplemental input |
| Inbox | `/inbox` | business confirmations, tool approvals and Agent questions across runs |
| Diagnostics | `/diagnostics` | counters, storage, resources, retirements and the live event feed |

Settings cover language (Simplified Chinese or English), light, dark or system appearance, local or UTC time display, connection facts and sign-out, write-only credentials, device-token commands and version facts. Preferences stay in the browser's local storage.

Business plugins ship no frontend code. Forms come from the plugin's JSON Schemas: `x-dsh-widget: textarea` renders a multi-line field, `credential` stores a credential reference and links to the credential editor, and `options` asks the plugin for choices through `POST …/config/options`. A business wait chooses its control from its response schema: closed choices, a choice with free-text notes, a boolean, text or a generated form.

## Build and test

```sh
pnpm run build:task-web
pnpm exec vitest run apps/task-web/tests
pnpm exec vitest run --config vitest.web.config.ts apps/task-web/tests/task-web.e2e.ts
```

`build:task-web` writes `dist/`, which the Task application serves; `pnpm run build` includes it. The client consumes the built `lib/` of `dsh-task-api-client`, `dsh-task-api-protocol` and `dsh-client-ui-primitives`, and the `--dsw-*` token sheets of `dsh-client-ui-theme`. The unit specs cover cron previews, formatting, configuration merges, schema forms and the session state machine. The browser test needs the built client; it boots the Task Profile with the [demonstration business plugin](tests/fixtures/demo-business.mjs), signs in with a launch link and drives inbox replies, manual triggers, cleanup retry, configuration edits, credentials and sign-out. `DSH_PLAYWRIGHT_EXECUTABLE_PATH` selects a local Chromium when Playwright's pinned browser is absent.

For a local preview with sample data, add rows of the demonstration plugin to a `--patch` file; its `definition` setting selects `defects`, `weekly`, `review`, `cleanup` or `agent`. `pnpm --filter @deepseek-ai/dsh-task-web-frontend exec vite` serves the client with hot reload on port 5180 and proxies `/api/task/v1` to `DSH_TASK_WEB_GATEWAY` (default `http://127.0.0.1:3081`); the proxy presents the gateway's own origin, so open a printed launch link with its port changed to 5180.
