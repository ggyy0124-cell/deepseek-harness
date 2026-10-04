# Agent Note: Task Web client hosting and browser session

Status: implemented

English | [中文](2026-10-03-task-web-client-hosting.zh.md)

## Problem

The [Task Web prototype](../../../../design/task-web/README.md) needed a shipped client, and the [capability decision](2026-10-03-task-web-client-capabilities.md) deferred serving one from the Task host. The client must sign in with the printed launch link, survive deep links to Run and definition pages, and stay within the Task gateway's origin, Host and CSRF checks without a second server.

## Decision

The client is the `@deepseek-ai/dsh-task-web-frontend` workspace application in `apps/task-web`, a Vite and React build over the upstream `ui-primitives` atoms and `ui-theme` token sheets; it reaches the gateway only through `dsh-task-api-client`. The Task application entry resolves the package's `dist/` and claims the WebServer fallback seat, so `/` and the API share one origin and the existing `--launch-link` URL opens the client. The index is public; authentication happens at `/auth/exchange` and the HttpOnly cookie, never at the asset server.

Existing files are served directly, fingerprinted `assets/` as immutable, and the index with a same-origin content security policy and `no-referrer`. A missing path receives the index only for a browser navigation (`Accept: text/html`), because definition identities such as `demo.defects` look like file names; script and asset requests for missing files still return 404. The client removes the `#launch=` fragment from history before exchanging it, also on a fragment change in an open tab, and rereads `/auth/session` once after a CSRF rejection, retrying the command with its original idempotency key.

## Alternatives considered

**Reuse `dsh-host-frontend-static`.** Rejected: it authorizes the index through the Web Profile's Connection service, which the Task Profile does not compose, and it deliberately returns 404 for client routes.

**Route by file extension or hash routes.** Rejected: dotted identities would 404 under extension rules, and hash routes collide with the `#launch=` fragment.

**Build the client into the Web shell's Cordis client plugins.** Rejected: the Task Profile has no client module runtime, and the Task client needs none of the Session chat surfaces.

## Consequences

`pnpm run build` builds `dist/` after the libraries; a source checkout without it serves 404 for the index. The [gateway acceptance test](../../../../apps/cli/tests/profiles/task/task-gateway.e2e.ts) checks the served index and policy, and the [browser test](../../../../apps/task-web/tests/task-web.e2e.ts) drives sign-in, replies, triggers, cleanup retry, configuration, credentials and sign-out against the shipped profile.
