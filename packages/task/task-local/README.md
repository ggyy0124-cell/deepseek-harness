---
description: "dsh-task-local: durable task configuration, execution, and recovery."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-local

English | [中文](README.zh.md)

## Summary

Run durable tasks on one continuously running local host. SQLite retains scheduling, checkpoints, business associations, and operation receipts while JSONL Sessions retain conversation history. Global and plugin limits constrain stage admission, and resource locks protect conflicting work. Shutdown preserves unfinished tasks; plugin removal cancels them and awaits cleanup.

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

The shipped `task` profile composes this provider with the Task API gateway. Direct mounts require `path` for SQLite and `resourceRoot` for Task-owned files; recorded preset revisions live in that database. A second host using the same database is rejected.

Waiting stages gain one priority point per `priorityAgingIntervalMs` (default 60,000 ms), capped by `priorityAgingCap` (default 100). Waiting age starts at the last durable Run update; equal effective priorities retain creation-time order. Resource-blocked stages do not consume concurrency slots.

Notifications consume bounded journal pages (`notificationBatchSize`, default 100) and persist acknowledgements. The log provider emits only store/sequence identity, Run identity, event and time. Failed deliveries retry with the same identity; providers implementing `TaskNotificationProvider` must deduplicate uncertain deliveries. A crash between logging and acknowledgement can repeat a log line; this is at-least-once delivery, not an exactly-once external side effect.

Cancellation records an overdue drain after `cancellationGraceMs` (30 seconds); shutdown does so after `shutdownTimeoutMs` (120 seconds). Both continue waiting for actual quiescence. Cleanup aborts its signal after `cleanupTimeoutMs` (120 seconds), then retains a blocked Run and resource locks after the callback settles. Repair the resource, then retry cleanup with the `cleanup` command or cancellation; either finishes with the outcome recorded when settlement began. Plugins must settle after cancellation; an OS supervisor may terminate a stuck process, with unfinished work reconciled after restart.

| Setting | Default | Effect |
|---|---|---|
| `concurrency` | `4` | Active stages across all plugins |
| `childConcurrency` | `4` | Live foreground child Agents per Task Run |
| `tickMs` | `1000` | Scheduler wake interval |
| `catchupLimit` | `10000` | Occurrences scanned per definition per tick |
| `catchupHorizonMs` | `2592000000` | Calendar catch-up window; older ranges are logged as skipped |
| `pendingLimit` | `100` | Unfinished scheduled runs per definition |

Polling waits its configured interval after the preceding poll ends. Calendar schedules use five-field cron expressions with explicit IANA time zones and `all`, `coalesce`, or `skip` policies. Bounded scans retain their cursor across ticks and restarts; queue pressure leaves unmaterialized occurrences pending. A schedule failure disables that definition, records a diagnostic and keeps the reason in `blockedReason` until the definition is enabled again.

A business wait releases stage permits and transient resources. Retained resources are released only after model/tool work drains and plugin cleanup succeeds. Failed cleanup blocks the task and preserves exclusions; repair the resource and retry cleanup. Missing business code prevents execution, while historical Sessions remain readable.

In either a special or an ordinary Run, an admitted parent model operation may choose to create foreground in-process child Agents through the captured Task preset. No child is created unless the parent Agent calls a delegation tool. Child Sessions belong to the same Run; they do not count as ordinary task dispatches. The parent model turn joins every child before the stage completes. Background or continuable child work is outside this ownership rule. A process restart records unfinished children as interrupted and blocks automatic replay of the parent model operation; the next stage exposes their Session IDs through `stage.children` for plugin reconciliation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Scheduling waits for Session recovery, the initial Loader tree and retained-code reconciliation. Diagnostics report `starting`, `running`, `failed` or `stopping`; failed recovery leaves scheduling disabled. Stopping during recovery awaits its completion and prevents a late timer from admitting work.

`stage.resource(key, type, request)` persists acquisition intent before calling an adapter. Restart marks live handles for reconciliation; cleanup retains per-resource progress and releases locks only after every adapter settles. Plugins register adapters through `resourceHandlers`. Built-in `task.directory` accepts `{}`; `task.worktree` accepts `{ repository, ref }`. Both verify private ownership before deletion. Worktree cleanup preserves file contents and symbolic-link targets under `resourceRoot` before removal. A moved worktree is blocked until its repository registration is repaired. `resourceProcessGraceMs` defaults to 5000 and `resourceOutputLimitBytes` to 65536.

Retirement commits disabled admission and a durable operation before cancellation. Recovery can reload an entry removed from Loader configuration using its saved module URL, entry digest and evaluated configuration. Keep the installed package and dependencies unchanged until retirement reports `complete`; missing or changed code blocks cleanup. Reinstalled definitions remain paused until explicitly enabled. This ordering also applies when a package manager changes code outside Loader.

`registerNotificationProvider(owner, id, provider)` gives each destination its own durable acknowledgement cursor and awaited disposal. `diagnostics()` reads complete-history counts and reports queue age, persistence barriers, resource holders, outstanding retirement and disk pressure. `diskFreeRatio` defaults to 0.1; unavailable filesystem statistics remain explicit.

Restored plugin fibers remain loaded while cleanup is blocked. After a retry completes retirement, the scheduler releases those fibers; shutdown awaits any ongoing release. Failed disposal logs `task.retirement.dispose-failed` and remains eligible for another release pass.

<details>
<summary>Implementation details</summary>

The [database](src/database.ts) commits task changes, audit records, child Session ownership and Session durability barriers atomically. The [Session adapter](src/sessions.ts) flushes each barrier before admission and verifies the database run-to-Session association. Model delivery uses a stable message identity and a recorded completed turn; an idle Agent alone is not evidence of success. Model cancellation enters the owning Session's authorization context, including when an external caller aborts its signal; interrupted operations retain their unconfirmed receipts.

The [engine](src/engine.ts) logs admission, transitions, dispatch association, operation reconciliation, scheduling pressure, and cleanup. Logs contain identities and state metadata; business input and model answers live in their durable records. No provider invariant companion is published: the Task companion owns Session/record comparisons, while transactional uniqueness and lock acquisition are enforced before admission.

Rediscovery of a business key still associates its source with an unfinished ordinary Run during cancellation or blocked cleanup. It does not deliver a new input or advance the observed business data until cleanup completes; a later discovery creates a successor after the Run ends.

Administrative commands commit state changes, original response snapshots and audit records in one SQLite transaction. Nested operations use savepoints; rolled-back operations publish no diagnostics or cancellation signals. Retry matching ignores JSON object key order, preserves array order and isolates keys by authenticated principal. Enable changes increment the definition revision. Cancellation marks the Run before aborting its worker after commit; the worker or scheduler drains and cleans resources asynchronously.

Forms are validated at registration and command ingress; schema changes require an explicit migration, while Runs retain their captured configuration and forms. Registration rejects unknown `x-dsh-` annotations, admission rejects invalid credential reference names, and supplemental input is checked against the Run's captured `supplement` schema. Business waits persist their own reply schema and creation time. Runtime tool approvals keep their tool call identity and model questions their structured questions; both persist separately and are withdrawn after interruption, so a stale request never resumes a new tool call. Offline backup and restore use the `maintenance` export under the Task application launcher.

</details>


No runtime invariant companion is published; the Task service companion compares SQLite execution records with Session persistence, while the provider enforces transaction and lock rules before admission.
-----

<a id="further-exploration"></a>
## Further Exploration

[Task package group](../../../packages/task/README.md) explains ownership; [architecture](../../../docs/architecture.md) explains profile composition.

-----

<a id="model-experience"></a>
## Model Experience

### Business model stage

#### What the model sees

The exact prompt supplied to `stage.model` becomes a durable user message in the task Session. The chosen preset supplies system instructions and tools. Replaying a completed operation returns its recorded answer without generating another request.

#### Token effect

Each new model operation adds its prompt and generated response. Task lifecycle remains in SQLite, and business plugins decide which updates enter later prompts.

#### KV Cache effect

A run retains its Session and preset across stages, preserving reusable conversation prefixes. Distinct executions start separate Sessions.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One writable host owns a local SQLite database. This provider does not coordinate distributed workers.
- Plugins must stop subprocesses and reconcile uncertain external writes. A plugin that never settles its cancellation can delay shutdown or removal.
- Recorded preset revisions name plugin packages rather than copying their code; external services and installed plugin code must remain available for recovery.

<a id="dev-note"></a>
### Dev Note

None.
