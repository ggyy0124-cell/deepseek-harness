# Agent Note: Task Web Session statistics from the stored Session log

Status: implemented

English | [中文](2026-10-12-task-web-session-statistics.zh.md)

## Problem

DSH Web shows a Session's statistics under its composer: turns and steps with the output speed, total tokens with the cache-hit share, and the context occupancy of the next request, each opening its details. Task Web showed none of them, so a person watching a Task Run could not see how much a Run had cost, how fast the model answered or how close the Session was to its context window. A Task Session is read from storage without a live Session or Agent, and Task Web loads only the public transcript, which omits retried attempts, compaction shadow prices and route capacity records.

## Decision

`GET /runs/{runId}/stats` folds the whole stored log with the Session projection units the Task host registered, through `SessionProjectionRegistry.restore`, the registry's cold read for a log without a live Session. The response carries the views of `sessionStats` (`dsh-session-stats`) and of `tokenUsage`, `contextPressure` and `contextBreakdown` (`dsh-token-meter`), so the figures are the ones DSH Web shows for the same log; a figure whose unit is not registered is null. The Task application patch mounts `dsh-session-stats`; Base already mounts `dsh-token-meter`.

The gateway keeps the checkpoint of the last fold per Run in memory for `statsCacheRuns` Runs (default 32). A later read starts at the checkpoint's last event, compares that event's fingerprint and folds only newer events; a changed fingerprint, a missing or version-mismatched unit row or an evicted checkpoint refolds from the first event.

Task Web shows the three readings under the Session's input box or read-only note, reads the statistics again 400 ms after each new transcript message or Run status change while the Session tab is shown, and keeps the last figures when a read fails. Each reading opens its details above it on wide screens and as a bottom sheet on a phone, where the row drops the output speed and shortens the cache-hit label so the readings fit one line.

## Alternatives considered

**Compute the figures in the browser from the transcript.** Rejected: the transcript omits `assistant/attempt` usage of retried requests, compaction shadow prices and `request/context` capacity records, so token totals and occupancy would differ from DSH Web, and the fold logic would be a second copy of the projection units.

**Add the figures to each transcript page or Session SSE frame.** Rejected: a page covers a window of the log while the figures cover the whole log, and the transcript cursor is limited to 2048 characters, which cannot carry the projection states.

**Fold the full log on every read without a checkpoint.** Rejected: a live Run is read again after every new message, so the cost would grow with the square of the log length.

**Read the persisted projection cache.** Rejected: its rows trail the log by up to `writeEveryEvents` events or `writeIntervalMs`, and its cold read still requires the complete log.

## Consequences

Task Web and DSH Web report the same numbers for the same Session, including retried attempts and compactions. The first read of a Run after a host start folds the whole log; later reads fold only new events, and the checkpoints of at most `statsCacheRuns` Runs stay in memory. The composition parts are character estimates, so they do not add up to the provider-reported occupancy; the panel says so. The Task snapshot asserts the figures of the replayed `model-wait` Session through the shipped profile, and `session-stats.e2e.ts` opens the readings and their details on a desktop and a phone viewport.
