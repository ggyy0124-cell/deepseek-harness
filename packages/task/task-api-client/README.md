---
description: "Call Task JSON operations through Fetch without a Cordis runtime."
kind: "package-library"
---

# @deepseek-ai/dsh-task-api-client

English | [中文](README.zh.md)

## Summary

Call declared Task JSON operations using standard Fetch. The client validates requests and responses, supplies bearer or cookie authentication and preserves structured errors. Commands retain caller-owned idempotency keys; transport failures never trigger an automatic write retry.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Construct `TaskApiClient` with an explicit API base URL, Fetch implementation and authentication callback. Call `request(operationId, request)` using the [protocol catalog](../task-api-protocol/README.md). Authentication is sampled per request. Browser commands include CSRF; bearer requests omit cookies. Redirects fail to prevent credentials from following a different endpoint.

`credential(reference, value?)` reads or replaces one shared credential, and `credentials()` lists the references named by installed definitions; neither returns a value. `TaskApiError.problem` carries validated server diagnostics and revision conflicts. Caller cancellation is forwarded to Fetch. Invalid parameters, missing write identities, unexpected response statuses and non-protocol errors reject. Error pages are not copied into exception messages.

**Runtime invariant:** No companion is published. Each operation validates its request and response directly; Fetch tests cover authentication and failure behavior.

Use `events({ signal, cursor? })` to receive `ready` and durable Task events. On a fresh subscription, wait for `ready` before fetching a REST baseline and retain incoming events during that fetch. Store the last delivered cursor and pass it on reconnection; a stale cursor requires a fresh subscription and baseline. Unknown event names are ignored. `eventLimitBytes` bounds a complete received frame, defaults to 262144, and includes UTF-8 framing bytes. Abort the signal to interrupt a pending read; ending iteration releases the reader. Automatic retry/backoff belongs to the calling application.

Use `request('getTranscript', { params: { runId }, query: { cursor, limit: '50' } })` for forward transcript windows; omit the cursor on the first read. Retain the returned `nextCursor` even when `items` is empty. This endpoint exposes stored messages; use `sessionEvents({ runId, signal, cursor? })` for independent Session replay.

<a id="model-experience"></a>
## Model Experience

None, as this package validates HTTP records without constructing model input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The caller owns reconnect policy, upload retry keys and download blob lifetime. This library does not start a Host.

<a id="dev-note"></a>
### Dev Note

None.
