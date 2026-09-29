---
description: "Task Profile Agent preset provider with immutable revision mounts."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-agent-presets

English | [中文](README.zh.md)

## Summary

Provide the ordinary Agent Preset service inside Task Profile and retain immutable preset revisions for durable execution. A Task run can resume with the same plugin composition after configuration changes or process restart, while existing clients continue using the shared `agentPresets/*` Remote protocol.

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

Task Profile mounts this directory-based roster under the shared `agentPresets` service key, which subagent delegation reads to compose children from the parent's preset. Task code reaches the Task API through `taskAgentPresets(ctx)`. `mountRevision()` mounts a retained composition by its managed path and content revision. Unnamed sessions use `default`; while `modeSelectionEnabled` is true, the volatile `selectedDefault` overrides it without a restart. Deleting the selected preset removes `selectedDefault` from this entry through the configuration editor when the profile composes one.

The shipped `standard`, `ptc`, and `cordis` Task presets expose only foreground one-shot in-process `subagent` and `subagent_fork` calls. Their results join the owning model turn; worker-thread `workflow` and `ralph` are disabled because their child starts do not inherit Task model admission. `minimal` has no delegation tool.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package owns the directory-based preset provider that the shared `dsh-agent-presets` package retired, and adds revision-specific standing mounts whose cache identity includes the immutable revision. A mount awaits every enabled row and rejects failed rows, rows waiting for a missing service, and rows that publish root-realm services. It does not publish a Typert contribution; Task Profile loads the `dsh-agent-preset-registry` protocol, whose `list`, `read`, and `select` endpoints resolve to this service.


No runtime invariant companion is published; the mount audit rejects every unusable row before a standing mount is recorded.
-----

<a id="further-exploration"></a>
## Further Exploration

[Task Local](../task-local/README.md) retains revision files. The [provider-isolation decision](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.md) explains protocol reuse and source parity; the [upstream merge note](../../../.agents/notes/implemented/architecture/2026-09-29-task-profile-upstream-0-1-7-merge.md) records why this roster is now Task-owned.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the retained preset plugins that supply each Task Agent's system instructions and tools.

#### KV Cache effect

A run mounts one immutable composition, keeping its system prompt and tool prefix stable across recovery.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Recovery requires the retained preset revision and every package referenced by that composition to remain available. Revisions captured before the upstream 0.1.7 merge name `@deepseek-ai/dsh-workflow-worker-thread`, which no longer exists, and cannot be remounted.
- The Remote `copy` and `deletePreset` methods are not reachable through the gateway, because the loaded registry protocol does not declare them.
- The coverage gate excludes this package's source; its unit suite has not been brought to the per-file coverage threshold.

<a id="dev-note"></a>
### Dev Note

None.
