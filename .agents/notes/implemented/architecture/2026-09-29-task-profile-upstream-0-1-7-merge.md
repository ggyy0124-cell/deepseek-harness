# Agent Note: Task Profile adaptation to the upstream 0.1.7 merge

Status: implemented

English | [中文](2026-09-29-task-profile-upstream-0-1-7-merge.zh.md)

## Problem

The fork merged upstream `deepseek-ai/deepseek-harness` through `dsh-v0.1.7-rc.2`, then through `dsh-v0.2.0-rc.1`, whose further changes required only the Task package version bump. Upstream deleted `@deepseek-ai/dsh-agent-presets`, the canonical source of the copied Task preset provider, and replaced it with the declarative `dsh-agent-preset-registry`. It also made `agent/created` a serial, awaited event and removed `agent/session-start`, replaced settings sections with volatile Config fields, renamed the code runtime to `ptcRuntime`, and advanced the Session writer to format V4. Each change reached a Task replacement provider, a Task preset, or the Task application patch.

## Decision

`dsh-task-agent-loop` takes the upstream Agent Loop through a three-way merge against the fork base. The four files carrying Task changes keep those changes; the other files match upstream after module identity normalization. The source-copy test pins the refreshed digest pairs, so Agent Loop parity stays enforced.

Task presets follow the declarative model upstream adopted when it retired `@deepseek-ai/dsh-agent-presets`. The Task bundle declares `standard`, `ptc`, `minimal`, and `cordis` with `dsh-agent-preset` rows copied from the Web declarations; subagent calls stay one-shot in the foreground with depth 1, and workflow rows stay disabled. A parity test admits only those differences. `dsh-task-agent-preset-registry` subclasses `dsh-agent-preset-registry` under the same `agentPresets` key, which `dsh-subagent` reads to compose a child from its parent's preset. Task code reaches the Task API through `taskAgentPresetRegistry(ctx)`.

The shared registry keeps revisions in memory and resolves a restarted Session's preset against the current declaration. A Task run must keep the composition it started with, so the Task registry records the declared child plugin list, the declaring row's resolution base, and a digest; Task Local stores that record in its operation receipts instead of copying preset directories. A recorded revision equal to the current declaration binds that declaration's live tree. Any other revision registers a private definition under a reserved `task-revision:` id through the shared registry's public `register` and `mount` operations; the Agents that recorded it share it, and it is withdrawn when the last one leaves while the shared registry keeps the retired tree for inherited children. Roster reads omit private definitions, and composed-preset reads report the declared id.

The default preset follows the shared registry's `default` and volatile `selectedDefault` fields on the `agent-preset-registry` entry. Task Agent Loop takes `maxParallelToolCalls` as a volatile field from the upstream merge.

The Task application patch removes its own `code-runtime` row because Base now mounts `ptc-runtime`. It disables `workflow-ptc` and `mcp-resources` beside the other per-Agent rows, and it loads the `dsh-agent-preset-registry` Typert contribution for the shared `agentPresets` namespace.

Task stage prompts use the producer-owned `task` message source kind required by Session V4. The transcript projection reads V4 tool-role result messages.

## Alternatives considered

**Keep a Task-owned directory preset roster.** Rejected because it kept a copy of the retired package outside source parity, a second preset declaration format, and a Remote surface that diverged from the shared protocol.

**Resolve a restarted run against the current declaration, as Web does.** Rejected because a profile edit between waits would change the tools and prompt of a running business execution.

**Add revision hooks to the shared registry.** Rejected because Task Profile keeps shared provider sources unchanged, and the public `register` and `mount` operations express private revisions.

**Rename the Task preset service.** Rejected because in-process subagents would stop inheriting the parent's preset. Delegation resolves the shared key through `ctx.get('agentPresets')`.

**Record the Task package's existing `as unknown` assertions in the unknown-cast baseline.** Deferred. The assertions predate the gate, and the gate is outside the Task CI surface; each one needs a typed replacement.

## Consequences

- A recorded revision names packages and a resolution base, not code; recovery requires those packages to remain installed where that base resolves them. Directory revisions recorded by earlier Task builds are refused as invalid receipts.
- Every declared Task preset activates at startup, as Web presets do. A declaration change adds one private tree per distinct recorded revision still in use.
- Task preset declarations must follow compatible Web declaration changes; the preset parity test makes unexpected drift fail locally.
- Stored `agent-presets` and `agent-loop` settings sections are no longer read; operators restate those values as volatile fields in the Task profile patch.
