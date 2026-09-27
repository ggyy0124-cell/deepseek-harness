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

Task Profile mounts this provider in place of `dsh-agent-presets`. `mountRevision()` mounts a retained composition by its managed path and content revision. Ordinary preset discovery, authoring, selection, and session projection retain the shared behavior.

The shipped `standard`, `ptc`, and `cordis` Task presets expose only foreground one-shot in-process `subagent` and `subagent_fork` calls. Their results join the owning model turn; worker-thread `workflow` and `ralph` are disabled because their child starts do not inherit Task model admission. `minimal` has no delegation tool.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package copies the shared preset provider and adds revision-specific standing mounts whose cache identity includes the immutable revision. It does not publish a second Typert contribution; Task Profile loads the shared package's generated protocol and resolves those endpoints to this service.


No runtime invariant companion is published; the shared Agent Preset companion owns the copied mount relationships, and source parity rejects Task copy drift.
-----

<a id="further-exploration"></a>
## Further Exploration

[Task Local](../task-local/README.md) retains revision files. The [provider-isolation decision](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.md) explains protocol reuse and source parity.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the retained preset plugins that supply each Task Agent's system instructions and tools.

#### KV Cache effect

A run mounts one immutable composition, keeping its system prompt and tool prefix stable across recovery.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Recovery requires the retained preset revision and every package referenced by that composition to remain available.

<a id="dev-note"></a>
### Dev Note

None.
