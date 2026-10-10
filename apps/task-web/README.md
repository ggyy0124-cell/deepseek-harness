# `@deepseek-ai/dsh-task-web-frontend`

English | [中文](README.zh.md)

The Task Web client is the browser console of the Task Profile. It implements the [Task Web prototype](../../design/task-web/README.md) over the [Task REST gateway](../../packages/task/task-api-gateway/README.md) and is served by the Task host on the gateway origin, so `dsh --profile task` serves both `/` and `/api/task/v1/`.

## Use the client

Start the host with `dsh --profile task` and print a sign-in link with `dsh --profile task --launch-link` in another terminal. Opening the printed `http://127.0.0.1:3081/#launch=…` link exchanges its single-use secret at `/auth/exchange`, removes it from the address bar and keeps an HttpOnly cookie session; the client sends the session's CSRF secret on every write. A tab that already shows the client also accepts a newly pasted link. When no session exists, the page shows the sign-in command; a used or expired link, an ended session, an unreachable host and a recovering scheduler each show their own state. When the gateway offers [password login](../../packages/bundle/task-app/README.md#intranet-access), the page shows a username and password form instead, keeps the launch-link command under a collapsed administrator entry, and reports a wrong password or a temporary lock under the form.

| Page | Path | Operations |
|---|---|---|
| Overview | `/` | attention counters, recent runs, upcoming triggers and execution permits |
| Tasks | `/definitions` | enable or pause definitions; trigger manual tasks |
| Task | `/definitions/{id}` | schedule, execution and business configuration (generated form or JSON), plugin checks, dynamic options, revision conflicts, runs and retirement |
| Runs | `/runs` | status, kind, task, business-key and creation-time filters with cursor pages |
| Run | `/runs/{id}` | live conversation and trajectory, replies, result documents, attachments, related runs, cancellation, cleanup retry, restart of a failed or cancelled run and supplemental input |
| Inbox | `/inbox` | business confirmations, tool approvals and Agent questions across runs |
| Diagnostics | `/diagnostics` | counters, storage, resources, retirements and the live event feed |

Settings cover language (Simplified Chinese or English), light, dark or system appearance, local or UTC time display, connection facts and sign-out, write-only credentials, device-token commands and version facts. Preferences stay in the browser's local storage.

Business plugins ship no frontend code. Forms come from the plugin's JSON Schemas: `x-dsh-widget: textarea` renders a multi-line field, `credential` stores a credential reference and links to the credential editor, and `options` asks the plugin for choices through `POST …/config/options`. A business wait chooses its control from its response schema: closed choices, a choice with free-text notes, a boolean, text or a generated form. Dialogs stop at the window height: the trigger, retirement and revision-conflict dialogs scroll their title and body while the footer buttons stay in view, and a rejected trigger scrolls to its first field error or its failure notice.

The Run conversation lists each stage instruction (long ones collapse), the Agent's answers, and the supplemental inputs and confirmation replies people gave, in arrival order with their stored values. Reasoning, tool calls and narration of a finished turn fold into one `Took …` row; the latest turn stays open while the Agent works or the Run needs attention. Waiting confirmations are cards in the Run's Interactions tab and in the Inbox; the conversation ends with a `Waiting for input` line instead of a card. Long card text collapses behind an expand control. The input box and the reply text boxes of a confirmation card send on Enter and break the line on Shift+Enter. When reading the Session fails repeatedly, the page names the cause and offers an immediate retry.

The Session tab switches between that conversation and a trajectory laid out like the DSH Web trajectory. Both views and the input box share one column that fills the space the navigation and the sidebar leave, up to 1120 px, and each view follows new messages and inputs at its end until the reader scrolls up; switching views starts at the end again. The trajectory toolbar chooses the timeline axis (recorded duration or equal widths), folds all turns or all tool calls, and searches. The timeline has an input row, a model row and a tool row; dragging focuses a time range and a click selects a block. The table lists each turn's steps, model requests and tool calls with token counts and durations; a request lasts from its logged start to its message, with the first-token delay shown apart from decoding, and a tool call from its logged start to its result. Selecting a row opens the record inspector in the right sidebar: a message has overview, preview, raw content and source tabs, a tool call has overview, arguments, result, schema and timing tabs, and the request behind an assistant message has overview, options, usage and timing tabs with the Run's token totals up to it. The sidebar's status tab holds the Run's status, times, identifiers and cleanup. The sidebar pushes the page aside above 1100 px and covers it below, resizes by dragging its edge, and keeps its width and open state in the browser.

## Build and test

```sh
pnpm run build:task-web
pnpm exec vitest run apps/task-web/tests
pnpm exec vitest run --config vitest.web.config.ts apps/task-web/tests/task-web.e2e.ts
```

`build:task-web` writes `dist/`, which the Task application serves; `pnpm run build` includes it. The client consumes the built `lib/` of `dsh-task-api-client`, `dsh-task-api-protocol` and `dsh-client-ui-primitives`, and the `--dsw-*` token sheets of `dsh-client-ui-theme`. The unit specs cover cron previews, formatting, configuration merges, schema forms, the conversation timeline, scroll following, the confirmation card's reply keys, the restart card of a failed or cancelled run, the trajectory projection, its overview and ledger, the record inspector, the sidebar layout and the session state machine, including password sign-in. The browser test needs the built client; it boots the Task Profile with the [demonstration business plugin](tests/fixtures/demo-business.mjs), signs in with a launch link and drives inbox replies, supplemental input, the Run column width, the live trajectory's follow of new input, the trajectory toolbar, timeline and record inspector, the sidebar, manual triggers (including the trigger dialog in a short window), cleanup retry, the restart of a failed run, configuration edits, credentials and sign-out; a second browser test signs in with the fixed account through a trusted host. `DSH_PLAYWRIGHT_EXECUTABLE_PATH` selects a local Chromium when Playwright's pinned browser is absent.

For a local preview with sample data, add rows of the demonstration plugin to a `--patch` file; its `definition` setting selects `defects`, `weekly`, `review`, `cleanup` or `agent`. `pnpm --filter @deepseek-ai/dsh-task-web-frontend exec vite` serves the client with hot reload on port 5180 and proxies `/api/task/v1` to `DSH_TASK_WEB_GATEWAY` (default `http://127.0.0.1:3081`); the proxy presents the gateway's own origin, so open a printed launch link with its port changed to 5180.
