---
description: "Task Profile Agent preset registry that retains recorded preset revisions."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-agent-preset-registry

English | [中文](README.zh.md)

## Summary

Declare Task presets exactly as other profiles do, with `@deepseek-ai/dsh-agent-preset` rows, and keep every Task run on the composition it started with. A run records its preset's declared plugin list once; waits, restarts, retained children, and dispatched ordinary work remount that recorded revision even after the declaration changes.

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

Task Profile mounts this registry in place of `dsh-agent-preset-registry` under the same `agentPresets` service key; the shipped Task presets are declared by the [Task App](../../bundle/task-app/README.md) bundle. Task code reaches the Task API through `taskAgentPresetRegistry(ctx)`. `captureRevision()` returns the current declaration of a usable preset as a `TaskPresetRevision`: the declared child plugin list as entry-list YAML, the declaring row's resolution base, and a SHA-256 digest. [Task Local](../task-local/README.md) stores that record in its database and validates it with `parseTaskPresetRevision()` when it reads it back. `mountRevision()` binds an unpublished Agent to a recorded revision and returns the declared preset id.

The roster, selection, Remote endpoints, session projection, and child inheritance are the shared registry's. `defaultId`, `selectedDefault`, and the `default` field behave as in other profiles.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

A revision whose digest equals the current declaration joins that declaration's live tree. Any other revision registers a private definition under a reserved `task-revision:` id, created from the recorded plugin list and resolution base; Agents that recorded the same revision share it. The private definition is withdrawn when its last mounting Agent leaves, and the shared registry disposes its tree once inherited children leave too. Roster reads omit private definitions, and `composedPreset()` and `composeFrom()` report the declared preset id, so child Session headers name the declared preset.

Mounting rejects a revision whose rows fail or keep waiting for a service after the Host tree settles; a failed private mount is released before the error propagates. Declaring rows cannot use the reserved id prefix.

No runtime invariant companion is published; the shared registry's companion owns the mount relationships, and recorded revisions only select which definition an Agent binds.

-----

<a id="further-exploration"></a>
## Further Exploration

The shared [preset registry](../../preset/agent-preset-registry/README.md) owns declarations and revisions; the [declarative preset decision](../../../.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md) explains them. The [Task merge note](../../../.agents/notes/implemented/architecture/2026-09-29-task-profile-upstream-0-1-7-merge.md) explains why Task runs record revisions over declarations.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the recorded preset plugins that supply each Task Agent's system instructions and tools.

#### KV Cache effect

A run keeps one recorded composition, so its system prompt and tool prefix stay stable across waits, restarts, and declaration edits.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A revision records the declared plugin list, not plugin code; recovery requires every package the list names to remain installed.

<a id="dev-note"></a>
### Dev Note

None.
