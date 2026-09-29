# Agent Note: Task Profile adaptation to the upstream 0.1.7 merge

Status: implemented

English | [中文](2026-09-29-task-profile-upstream-0-1-7-merge.zh.md)

## Problem

The fork merged upstream `deepseek-ai/deepseek-harness` through `dsh-v0.1.7-rc.2`. Upstream deleted `@deepseek-ai/dsh-agent-presets`, the canonical source of the copied Task preset provider, and replaced it with the declarative `dsh-agent-preset-registry`. It also made `agent/created` a serial, awaited event and removed `agent/session-start`, replaced settings sections with volatile Config fields, renamed the code runtime to `ptcRuntime`, and advanced the Session writer to format V4. Each change reached a Task replacement provider, a Task preset, or the Task application patch.

## Decision

`dsh-task-agent-loop` takes the upstream Agent Loop through a three-way merge against the fork base. The four files carrying Task changes keep those changes; the other files match upstream after module identity normalization. The source-copy test pins the refreshed digest pairs, so Agent Loop parity stays enforced.

`dsh-task-agent-presets` becomes Task-owned. Its original no longer exists, so the parity pairs for its source and shipped presets are removed. The package declares the preset vocabulary, Remote error details, projection map entry, selection event, and Session event locally, because a type-only import disappears from emitted declarations. It keeps the `agentPresets` service key because `dsh-subagent` reads that key to compose a child from its parent's preset. The upstream registry declares the Context type for that key, so Task code reaches the Task API through `taskAgentPresets(ctx)`. The unit suite of the retired package moves into the Task package.

The Task preset default reads the volatile `selectedDefault` and `modeSelectionEnabled` fields. Deleting the selected preset removes `selectedDefault` from the provider's own entry through `configEditor`. Task Agent Loop takes `maxParallelToolCalls` as a volatile field from the upstream merge.

The Loader now settles a subtree when a row's import or activation rejects. The Task preset mount awaits each enabled row and rejects failed rows, rows waiting for a missing service, and rows that publish root-realm services. Task mounts keep rejecting pending rows because a Task run has no later re-audit point.

The Task application patch removes its own `code-runtime` row because Base now mounts `ptc-runtime`. It disables `workflow-ptc` and `mcp-resources` beside the other per-Agent rows, and it loads the `dsh-agent-preset-registry` Typert contribution for the shared `agentPresets` namespace. Task presets rename their disabled workflow row to `workflow-ptc`.

Task stage prompts use the producer-owned `task` message source kind required by Session V4. The transcript projection reads V4 tool-role result messages.

## Alternatives considered

**Port Task presets to the declarative registry.** Rejected for this merge because Task runs capture immutable preset directories by content digest, and the registry declares presets inside profile patches. Moving revision capture to declarations changes durable Task recovery and needs its own design.

**Rename the Task preset service.** Rejected because in-process subagents would stop inheriting the parent's preset. Delegation resolves the shared key through `ctx.get('agentPresets')`.

**Record the Task package's existing `as unknown` assertions in the unknown-cast baseline.** Deferred. The assertions predate the gate, and the gate is outside the Task CI surface; each one needs a typed replacement.

## Consequences

- Preset revisions captured before this merge name `@deepseek-ai/dsh-workflow-worker-thread` and cannot be remounted. Runs that must continue across the upgrade need a finished run or a fresh revision.
- The Remote `copy` and `deletePreset` methods of the Task preset provider are not reachable through the gateway, because the loaded registry protocol does not declare them.
- The coverage gate keeps excluding the Task preset source until its moved suite reaches the per-file threshold.
- Stored `agent-presets` and `agent-loop` settings sections are no longer read; operators restate those values as volatile fields in the Task profile patch.
