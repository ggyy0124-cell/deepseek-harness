---
description: "Authenticated Task REST operations and browser/device credential management."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-api-gateway

English | [中文](README.zh.md)

## Summary

Control Task definitions and executions over authenticated HTTP without exposing internal checkpoints. Browser clients use a one-time launch exchange or an optional fixed-account password login and CSRF-protected cookies; native clients use revocable bearer credentials. These routes support future Task Web UI and native clients; the profile currently serves the backend only.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Task application mounts this package at `/api/task/v1` using the unmodified Host WebServer, Task service and Credentials provider. Local application code provisions credentials through `createLaunchToken()` or `createDeviceToken()` on `ctx.taskGateway`; `revokeDeviceToken()` invalidates future device requests. These methods are not public HTTP provisioning routes. A caller may display an issued secret once through its local application interface; it must not put secrets in diagnostic logs.

Exchange a launch secret with `POST /auth/exchange`, an exact Origin header and JSON `{ "token": "..." }`. The response sets an HttpOnly, SameSite Strict cookie and returns the CSRF value and session expiry. `GET /auth/session` recovers both from an authenticated browser. Cookie writes require the same Origin and `X-CSRF-Token`; bearer requests use `Authorization`. All Task mutations require `Idempotency-Key`. Authenticated `GET /openapi.json` describes the mounted JSON operations and browser exchange.

With `passwordLogin.enabled`, `POST /auth/login` with an exact Origin and `{ "username", "password" }` opens the same cookie session as the exchange. The password is the value of the `passwordLogin.passwordRef` credential, read on every attempt and compared by digest in constant time; `PUT /credentials/{reference}` refuses that reference with `403 credential_reserved`, so only `dsh --profile task --password-set` on the host sets it. Failures count per client address and per username; the attempt that reaches `maxFailures` inside `failureWindowMs` locks that address or username for `lockoutMs`, and locked attempts return `429 login_throttled` with `Retry-After`. Counters live in memory. An unconfigured password credential makes every login return 401 and logs `password_unconfigured`; login diagnostics record the outcome and client address, never the submitted values. Unauthenticated `GET /auth/methods` returns `{ "password": boolean }` so a client can choose its sign-in form.

| Field | Default | Meaning |
|---|---|---|
| `publicOrigin` | Empty | Exact browser origin; empty resolves to HTTP loopback and the actual server port |
| `trustedHosts` | `[]` | Further `host` or `host:port` authorities accepted besides `publicOrigin`, with its scheme; a bare host means the server port. Required when the server listens on all interfaces |
| `passwordLogin.enabled` / `username` | `false` / empty | Offer the fixed-account password login; the username is required when enabled |
| `passwordLogin.passwordRef` | `TASK_WEB_PASSWORD` | Credential reference holding the password |
| `passwordLogin.maxFailures` / `failureWindowMs` / `lockoutMs` | 5 / 900000 / 900000 | Failure budget per address or username, its window, and the lock that follows |
| `bodyLimitBytes` / `responseLimitBytes` | 1048576 / 4194304 | Complete JSON byte limits |
| `bodyTimeoutMs` | 30000 | Deadline for reading a request body |
| `pageSize` | 50 | Default Run page size, bounded by 200 |
| `transcriptPageBytes` | 131072 | JSON bytes of transcript messages after which one transcript window ends |
| `launchTtlMs` / `sessionTtlMs` | 60000 / 2592000000 | Bootstrap and browser credential lifetimes |
| `credentialLimit` | 100 | Maximum retained live entries per credential category |
| `eventPollMs` / `eventHeartbeatMs` | 1000 / 15000 | Journal poll and heartbeat intervals |
| `eventBatchSize` / `eventBufferBytes` | 512 / 2097152 | Replay page count and complete socket buffer limit |
| `eventDrainTimeoutMs` / `eventConnectionLimit` | 15000 / 32 | Slow-socket deadline and simultaneous stream limit |

Set `publicOrigin` or `trustedHosts` explicitly when using a reverse proxy or non-loopback browser address. Each request is matched to the origin whose authority equals its Host, and its Origin must equal that origin; forwarded headers do not change trust decisions. HTTPS origins set Secure cookies; TLS termination remains the deployment's responsibility.

-----

<a id="understand-the-implementation"></a>

`POST /definitions/{definitionId}/retirement` accepts the current revision and an idempotency key, closes admission and returns 202 with a durable operation identity. Poll `GET` on the same URL until `state` is `complete` before removing or replacing the installed package. `blocked` retains cleanup evidence for repair and retry. `GET /diagnostics` returns scheduler, queue, persistence, resource and disk counters without business payloads.

## Understand the implementation

<details>
<summary>Implementation details</summary>

The [authentication store](src/auth.ts) serializes grant changes through Credentials and stores device and launch digests. Signed browser cookies refer to expiring persisted sessions. Authorization rereads the grant for every request, so device revocation does not depend on gateway reload.

The [HTTP consumer](src/index.ts) applies Host/Origin checks, bounded JSON parsing, runtime protocol validation and value-free request diagnostics. [Operation dispatch](src/operations.ts) uses the engine's atomic command receipts; replay returns the original admission projection. Run pages retain an insertion high-water mark, excluding later inserts. Status filtering reflects current state, and a changed continuation membership returns `cursor_stale` so the client restarts pagination.

The [projection](src/projection.ts) excludes private execution fields. Definitions without forms expose schema version zero and a JSON editor; declared forms use validated Draft 2020-12 schemas, optimistic configuration revisions and explicit migrations. Business waits project their durable identity and revision. Gateway disposal removes routes, closes active requests and awaits handler completion. No invariant companion is published: the Task package owns record/Session comparisons; this consumer validates HTTP ingress and DTOs directly.

`GET /events` publishes a `ready` cursor followed by committed Task journal notifications. Fresh clients subscribe before acquiring their REST baseline; reconnecting clients pass the last delivered cursor in `Last-Event-ID` or the `cursor` query parameter. The cursor contains the database identity, and incompatible or future positions return 409 before streaming. Payloads contain event names, run identities and UTC times, never journal details. Notifications prompt clients to refetch affected resources. Bounded SQLite pages and socket buffers prevent an offline client from accumulating an in-memory replay queue. Slow drains, expired authorization and plugin unload close the connection; clients reconnect and repair from the journal. The gateway checks authorization before each replay batch.

`GET /runs/{runId}/transcript` reads existing Session persistence through a read-only handle without activating an Agent. `limit` bounds source events and `transcriptPageBytes` bounds the JSON bytes of the projected messages, so internal-only pages may be empty while their cursor advances and a page may end before `limit`; a message larger than the byte limit forms a page of its own. Follow `nextCursor` while `hasMore` is true; retain the final cursor for later appends. A missing or changed anchor returns `cursor_stale`. Only original user, assistant and tool-result messages are public; model-only replacements, replay state and private tool metadata are excluded. Image and file blocks expose display metadata. Every message carries the loop `turn` and `step` that logged it, null before the first step of a turn and between turns. User messages carry their `source` (`kind` plus the fields of that kind), which tells a person's prompt from injected context. Assistant messages carry the model name, the token counts the provider reported for that request, the `startedAt` of the request (its step start) and `firstTokenAt`; tool results carry the `startedAt` of their tool call; fields that do not apply or that the log lacks are null. The `requests` of a page list the request headers logged in its window: sequence, time, reason, call options and the tool schemas the model saw. The opaque cursor also carries the loop position and up to four tool calls without a result, so these fields stay exact across pages and live polls; a call whose id is longer than 128 characters has no start time. `/runs/{runId}/session-attachments/{sequence}/{index}` verifies the visible message reference before streaming bytes through the attachment provider. A Session that is not yet persisted returns `409 session_unavailable`; a missing visible attachment returns 404. Gateway disposal and premature client disconnects abort downloads and await read-handle closure; a completed response closes normally. Storage may materialize more data internally than the requested window.


`GET /runs/{runId}/inputs` lists the supplemental information and business-wait replies people gave the Run in arrival order, with an arrival time and whether a stage has consumed each; plugin dispatches and wait timeouts are omitted. Session SSE at `/runs/{runId}/events` has its own transcript cursor and never activates an Agent. Business waits, tool approvals and model questions share the interaction API; `GET /interactions` lists the waiting ones across Runs in creation order. Cancelled or interrupted runtime requests are withdrawn. A restarted plugin must ask for a new tool approval. `POST /runs/{runId}/cleanup` retries blocked cleanup with the outcome recorded when settlement began and returns 202. `POST /runs/{runId}/restart` reserves a new ordinary Run for the business key of a failed or cancelled ordinary Run, returns 201 with the new Run, and fails with `409 invalid_state` unless that Run is the newest of its key and the definition is enabled. Model/preset/permission discovery uses `/catalog`, where presets report their display name and description; optional plugin checks and option discovery receive a cancellation signal.

`/runs/{runId}/attachments` accepts authenticated multipart `files`, persists an immutable SHA-256 blob and a principal-scoped retry receipt, and rejects new uploads with `409 run_readonly` once the Run is cancelling, cleanup-blocked or terminal. Scoped downloads support one byte range. Configure `attachmentRoot` (required), `attachmentFileLimitBytes` (52428800), `attachmentUploadLimitBytes` (209715200), `attachmentUploadTimeoutMs` (120000), and `attachmentFileLimit` (20). Configuration checks use `configCheckTimeoutMs` (60000). Plugins must honor their cancellation signal.

`GET /credentials` lists the references named by installed definitions' `x-dsh-widget: credential` fields, each with its naming definitions and value-free status. `GET /credentials/{reference}` returns only configured/writable booleans; `PUT` replaces a shared credential value and never echoes it. Credential replacement is an idempotent assignment, separate from Task command receipts. Cookie writes require CSRF. `/health` and `/ready` require authentication; `/ready` returns 200 only after successful launcher startup and Task recovery with a running scheduler, otherwise 503. `/auth/logout` revokes the browser session.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Task subsystem](../../../docs/subsystems/task.md), [protocol](../task-api-protocol/README.md), [Fetch client](../task-api-client/README.md), [Task application](../../bundle/task-app/README.md).

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through Task commands; business plugins and the Session adapter own model-visible delivery.

#### KV Cache effect

No direct changes; the owning Task Session retains its conversation prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Session SSE contains persisted messages rather than transient token deltas. Session attachment downloads stream whole objects; Run upload downloads also support a single byte range.
- Run pagination uses indexed SQL filters and bounded pages. Attachment listings scan retained upload receipts; blob retention remains an operator responsibility.
- Plugin checks must honor cancellation. Arbitrary business JSON is not a secret-detection mechanism.
- Password login has one shared account and one principal, so inputs and replies are not attributed to a person. Over plain HTTP the password and session cookie cross the network unencrypted; login counters reset when the host restarts.

<a id="dev-note"></a>
### Dev Note

None.
