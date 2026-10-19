# Agent Note: Raw Session events in Task Web behind a host flag

Status: implemented

English | [中文](2026-10-19-task-web-raw-session-events.zh.md)

## Problem

Diagnosing a Task Run often needs the stored Session events themselves: stream chunks, lifecycle events such as `step/start` or `working-directory/change`, raw tool arguments and the events that the transcript projection drops. DSH Web shows them through the optional Developer Tools bundle (`dsh-experimental-inspector-profile`) and its Session Inspector, but that inspector is a Web client plugin built on the DSH Web Session, Chat and Sidebar services. Task Web is a separate Vite application with a strict content security policy and no Cordis client loader, the Task Profile replaces the shared Session service with Task-owned providers, and the gateway exposes only the projected transcript, so the inspector cannot be mounted in either.

## Decision

`GET /runs/{runId}/session-log` (`getSessionLog`) returns a Run's stored events unprojected: each item carries `sequence`, ISO time `at`, `type` and the persisted JSON `event`. It uses the transcript's read-only handle, ownership check and forward cursor anchored on the previous event's fingerprint, with `limit` and the new `sessionLogPageBytes` budget (default 512 KiB) bounding a window; one larger event forms a window alone. Because the values are unredacted, the gateway answers `404 session_log_disabled` unless its `sessionLog` option is set, and the Task application sets that option from a new `--session-log` startup flag, so turning it on needs no profile patch.

Task Web adds a third Session view, Raw events. It nests events by loop position, expands assistant message streams into one row per chunk under the `block-start` of their block, filters by type with `*` wildcards while keeping matching rows' parents as context, and shows a selected row's stored JSON. It reads up to 1000 events at a time, offers the next batch, and at the end of the log reads appended events after each new transcript message or Run status change. A disabled host, a Session not yet stored and a failed read each have their own state. The grouping follows the Session Inspector's log view, and the code is Task-owned.

## Alternatives considered

**Mount the Developer Tools bundle in the Task Profile.** Rejected: Task Web has no host for Web client plugins, and the Session Inspector depends on the DSH Web Session and Chat services that the Task Profile does not run. Its NodeJS diagnostics also allow arbitrary code execution and capture unredacted fetches, which a deployed Task service must not expose.

**Open copies of Task Session files in a separate DSH Web profile.** Kept as an offline workaround only: it needs file copies, because opening a live Task Session from DSH Web would take its write ownership, and Task-specific events are not guaranteed to render there.

**Serve the route always.** Rejected: raw events contain tool arguments and results, including values that the transcript projection leaves out, so exposing them is an explicit operator choice per host start.

**Reuse the Session Inspector package's grouping code directly.** Rejected: it is a client plugin bound to DSH Web's Session event source and stores; importing it into Task Web would pull those services into the bundle and couple the Task fork to an experimental upstream package.

## Consequences

Operators can inspect any Run's stored events from Task Web after restarting the host with `--session-log`; without the flag nothing changes. Raw reads cost what transcript reads cost, plus larger windows. The view inspects only the parent Run's Session; child agent Sessions and projection control frames are not listed. `session-log.e2e.ts` replays the recorded `model-wait` Session on a host started with the flag and drives the view.
