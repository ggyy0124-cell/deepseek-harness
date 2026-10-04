# Agent Note: Independent Task application

Status: implemented

English | [中文](2026-09-13-task-independent-application.zh.md)

## Problem

A reusable Task backend must serve future Web and native applications without depending on their implementation or changing the original Base and Web applications.

## Decision

The shipped Task profile composes Base and Task App. Task App mounts the unchanged Host WebServer, Task-specific runtime providers and REST gateway. Its current scope excludes business plugins, Task Web UI and native client applications. It has no frontend assets or browser auto-open; startup announces the API endpoint, and `--launch-link` prints a browser login URL ([Web client capabilities](2026-10-03-task-web-client-capabilities.md)). Default legacy Task compositions migrate to the new bundle list while explicit custom compositions remain unchanged. Base, Web App and shared runtime sources retain their original source.

Business plugins own stages, configuration schemas and optional checks/options, with one special task per Cordis fiber. No browser code comes from business plugins. Draft 2020-12 validation permits local references only, requires explicit schema-version migration, and captures forms with each Run. Ordinary Runs inherit their parent's configuration and forms. Existing business waits keep their persisted schema and revision. Runtime approvals/questions are durable records; a response must still have an admitted matching waiter, input revision and expiry. Restart withdraws interrupted runtime requests, so stale approval cannot authorize a new tool execution.

A discovery associated with an ordinary Run that is cancelling or has blocked cleanup records its source without delivering new input or advancing the observation.

REST commands retain atomic engine receipts. Task journal SSE and Session transcript SSE use independent cursors and bounded pages. Session reads never activate Agents. Transcript and attachment reads return `409 session_unavailable` while Session persistence is unavailable, allowing clients to retry a provisioning Run. Attachment uploads use bounded multipart bodies, immutable digest blobs and principal-scoped durable retry receipts; downloads require the owning Run and support one range. Browser authentication uses launch exchange, signed cookies, CSRF and revocation. The local administration profile provisions revocable API bearer credentials under the shared credential document’s cross-process lock. Browser authentication remains an API capability for future integrations; the backend does not expose a login page. Shared credential references expose presence and write-only replacement, with values excluded from response/log DTOs.

Administrative backup requires a stopped Task host and acquires the same exclusive owner lock as the engine. It copies SQLite through its backup API and hashes exact files. Restore validates the manifest, bytes and database before publishing into an empty destination, relocates retained presets and changes the Task stream identity. Credentials and external operations are not rolled back. This implementation uses an offline consistency barrier; it does not offer live backup or install an operating-system daemon.

Retirement and resource acquisition retain durable intent because process death can occur between a local commit and an external acknowledgement. Recovery reloads unchanged installed code from saved entry metadata and reconciles resource handles before reuse. Filesystem adapters verify ownership and preserve worktree changes before deletion. Package removal must follow completed retirement; an entry digest detects replacement but does not preserve a removed package or its dependencies.

Scheduler readiness follows both launcher completion and Task recovery. The timer is installed only after recovery settles successfully; closing during recovery fences late installation and awaits the recovery promise. A failed recovery remains observable without admitting work.

## Validation

Focused engine tests cover schema migration, form validation, durable approvals, cancellation and wait expiry. Profile tests cover independent dispatch, same-Session restart, HTTP authentication/receipts, attachment replay/ranges/read-only denial, Session SSE and administration. Source and built profile tests assert that API operations work without frontend files and that the root and index page return 404. The source-isolation check rejects changes to protected original modules.

## Alternatives considered

Bundling a Task frontend would couple backend acceptance to presentation work. A Cordis Task panel would also retain the Web application dependency. Business-specific components would couple each plugin to a frontend release. The backend retains the extension model and public API; future shared clients remain independently scoped work.

## Consequences

The Session feed contains persisted messages. Attachment downloads verify that the selected event and block belong to a visible original message in the Run-owned Session. Model-only replacements cannot grant attachment access. Plugins must settle asynchronous checks after cancellation. Filesystem backup publication uses atomic rename; successful publication does not promise power-loss durability beyond the filesystem. Old content-addressed blobs have no automatic retention/garbage-collection policy.

Admission adds configurable capped waiting priority and preserves creation-time ordering on ties. Notifications persist replay acknowledgements and expose stable identities for provider deduplication. Configurable cancellation and shutdown deadlines record overdue drains without releasing live resources; cleanup deadlines abort the plugin signal and retain blocked resources until repair.
