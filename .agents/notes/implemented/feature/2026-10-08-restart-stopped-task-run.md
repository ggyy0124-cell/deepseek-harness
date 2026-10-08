# Agent Note: Restart a failed or cancelled Task Run

Status: implemented

English | [中文](2026-10-08-restart-stopped-task-run.zh.md)

## Problem

A `failed` or `cancelled` ordinary Run is final: its Session is closed, cleanup has removed its files, and its business key reservation has ended. A person who reads the stop on the Run page can only wait for the plugin to dispatch the business object again, and a polling plugin that skips content it already handled never does. Dispatching again from the poll restarts work that a person may have ended on purpose, without anyone asking.

## Decision

The `restart` command (`POST /runs/{runId}/restart`, operation `restartRun`) reserves a new ordinary Run for the business key of a `failed` or `cancelled` ordinary Run and returns it with status 201. The new Run reports `restartedFrom`, the identity of the stopped Run. Its input is the latest input the stopped Run observed, and it uses the definition's current configuration, forms and code version. The stopped Run does not change.

The command fails with `invalid_state` unless the stopped Run is the newest ordinary Run of its business key and its definition is installed and enabled. A Run of any other kind or status, including a Run still settling or blocked in cleanup, is refused. Matching requests replay the original result like every other command.

The engine does not decide where the new Run continues. A plugin that can resume reads the stopped Run through `restartedFrom` and adopts its checkpoint; a plugin that cannot starts over from the input. Task Web offers the action on the result page of a stopped Run, links to the newer Run when one exists, and shows `restartedFrom` in the Run panel.

## Alternatives considered

**Reopen the stopped Run.** Rejected: ended Runs are final, their Sessions are closed and their resources are released. Reopening needs a second lifecycle for every state, and the audit trail of the stop would be rewritten.

**Dispatch the continuation from the polling plugin.** Rejected: a poll cannot tell a failure from a stop that a person chose, and it restarts work without being asked. A person who wants the work again presses one action on the Run they are reading.

**Copy the stopped Run's checkpoint in the engine.** Rejected: checkpoints are private plugin data and may refer to files that cleanup removed. Only the plugin knows what to restore and which phase is safe to repeat.

**Restart any stopped Run of a business key.** Rejected: an older Run of the key would start a second line of work next to a newer one, and the key allows one unfinished Run at a time. Restarting only the newest Run keeps one line per business object.

## Consequences

A person can continue a stopped business object from the Run page without changing plugin configuration. Every plugin that wants more than a restart from the input must read `restartedFrom` itself. The new Run starts from the latest observed input, so a business object that changed after the stop is restarted with its newest content. Task database records written before this change report `restartedFrom` as `null`.
