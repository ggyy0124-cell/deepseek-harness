# Agent Note: Task backend capabilities for the Web client

Status: implemented

English | [中文](2026-10-03-task-web-client-capabilities.zh.md)

## Problem

The [Task Web prototype](../../../../design/task-web/README.md) needs facts and operations the Task gateway did not expose. A browser had no supported way to obtain a launch secret. Business waits lost their structure when the prompt was not a string, tool approvals did not name the tool call being approved, and Agent questions were flattened into one title. An inbox had to query every run separately. A Run whose cleanup failed reported only `blocked`, and retrying cleanup through cancellation replaced a recorded success with `cancelled`. Forms gave clients no way to recognize credential fields, dynamic options or multiline text, so credential references could not be listed. Supplemental input had no declared shape, run history could not be filtered by dispatching run or by several statuses, and a definition paused by the scheduler gave no reason.

## Decision

The Task profile still serves no frontend. `dsh --profile task --launch-link` issues a single-use browser launch secret through the same credential store as the gateway and prints `{ url, expiresAt }`, with the secret in the URL fragment of the host on `--port` or the administration `publicOrigin`. A running gateway accepts the secret because it rereads the shared credential document; the browser posts it to `/auth/exchange`. Exchange and `GET /auth/session` also return the session expiry.

Business wait prompts may be `{ title, body, attachments }`: `body` is Markdown and `attachments` name Run attachments. Waits record their creation time. Runtime tool approvals keep the requesting `callId`, and Agent questions keep each question with its header, detail, selection mode and option descriptions. Every interaction DTO names its Run, and `GET /interactions` lists waiting business replies, approvals and questions across Runs in creation order.

Terminal settlement records the decision as the Run's `outcome` before cleanup starts. After a cleanup failure the Run remains `blocked` with that outcome. `POST /runs/{runId}/cleanup` (command `cleanup`) retries only a blocked cleanup, and cancellation of such a Run uses the same recorded decision, so a retry finishes as the original succeeded, failed or cancelled Run.

Plugin forms accept one Task annotation, `x-dsh-widget`, with the values `textarea`, `credential` and `options`; registration rejects other `x-dsh-` keys, and credential widgets require string values that are valid credential reference names. `GET /credentials` lists the references named by installed definitions' current configuration with value-free status. An optional `forms.supplement` schema validates supplemental input against the schema captured by each Run, and both definitions and Runs publish it.

Runs publish their schedule `occurrence`, including coalesced calendar ranges, and run queries accept comma-separated statuses and `parentRunId`. The scheduler stores its block reason on the definition, enabling clears it, and definitions publish an `availability` derived from installation, enablement, that reason and the latest retirement. Catalog presets report their display name and description. Task database schema version 9 adds the parent and waiting-interaction indexes; records written earlier remain readable without rewriting.

## Alternatives considered

**Serve the Web client from the Task host now.** Deferred with the Web implementation: a hosting plugin without built assets would only serve fixtures, and the launch secret works unchanged once a client is hosted on the gateway origin.

**Open a browser from the administration command.** Rejected until the profile hosts a client; opening the link would land on a 404 page. Printing the link also supports a development client behind a proxy whose origin is configured as `publicOrigin`.

**Retry cleanup only through cancellation.** Rejected as the sole operation: cancellation of a running Run must keep its meaning, and a client needs an operation that fails visibly when cleanup is not blocked. Cancellation of a cleanup-blocked Run still keeps the recorded outcome because both reach the same settlement.

**Expose stage checkpoints or phase state.** Rejected: checkpoints are private plugin data and may contain business content. Clients use status, reason, outcome, waits and transcripts.

**Aggregate interactions in clients.** Rejected: an inbox would issue one request per unfinished Run and still miss approvals raised while a Run reports `running`.

**Plugin-supplied form components or open-ended hints.** Rejected: plugins ship no frontend code, and an unbounded hint vocabulary cannot be validated at registration. Credential references are not inferred from field names.

## Consequences

Clients can build login, inbox, cleanup repair, credential and lineage screens from public data. Every `x-dsh-` key in a plugin schema is reserved, including property names and object keys inside `default`, `const` or `enum` values. Runs that entered blocked cleanup before this change have no recorded outcome until their next settlement, and their waits use the Run update time as creation time. A launch link printed for the wrong port or origin cannot be exchanged. Run query `status` is now a list in `TaskRunQuery`, and DTO additions rely on clients ignoring unknown fields.
