# Agent Note: Task Profile provider isolation

Status: implemented

English | [中文](2026-09-11-task-profile-provider-isolation.zh.md)

## Problem

Durable business tasks must retain a Session across confirmation waits and process restarts while preventing generic Agent controls from running that Session outside task admission. Immutable preset revisions and a wake operation for an already persisted inbox message are also specific to task execution. Adding these rules to the shared Session, Agent, Agent Loop, JSONL persistence, and Agent Preset packages would change every profile and couple ordinary conversations to the Task database.

## Decision

The Task application patch disables the five shared provider rows and inserts Task-specific replacements under new Loader identities. `dsh-task-session`, `dsh-task-agent`, and `dsh-task-session-persistence-jsonl` subclass the shared providers and add task-owned authorization checks. `dsh-task-agent-loop` and `dsh-task-agent-presets` copy the shared implementations because their required changes are inside private driver and standing-mount logic. The base and Web profiles continue to mount the shared packages, whose source remains unchanged.

The Task SQLite database is authoritative for execution state and the run-to-Session relation. Session JSONL stores ordinary conversation events only under the DSH home's `tasks/sessions` directory, keeping Task Sessions out of other profiles' Session catalogs. Task stages persist a uniquely identified inbox message before waking the Task Agent, then correlate that message with a completed turn before confirming the model operation. Recovery checks the database association and persistence record before publishing an Agent. A terminal Session remains readable; Task Profile mutation, persistence-write, Agent-command, resume, and task-parent creation paths require the provider's asynchronous Session authority.

A business definition registration carries the contributing plugin's exact Cordis context. The provider installs the registration effect on that context, allowing several plugin fibers to coexist while limiting each fiber to one special definition. Fiber disposal closes admission and awaits cancellation and cleanup before the old executable definition is released.

Model cancellation callbacks explicitly enter the owning Session's authority. An AbortSignal listener executes in its caller's asynchronous context, so registering it inside authorized model work does not authorize a later external abort. The Session adapter delegates this callback to its authorized abort operation; a regression test interrupts an active model stream from outside the Task context and checks that its receipt remains unconfirmed.

The replacement preset provider occupies the shared `agentPresets` service key that subagent delegation reads. Task Profile explicitly loads the `dsh-agent-preset-registry` generated Typert contribution for that namespace, so its `list`, `read`, and `select` endpoints resolve to the Task implementation. The replacement package does not publish a Typert contribution. Upstream retired the shared directory-based package, so the Task package declares its own preset vocabulary ([merge note](2026-09-29-task-profile-upstream-0-1-7-merge.md)).

The copied Agent Loop has an executable parity check. Unchanged sources compare byte-for-byte after module identity normalization. Each approved differing file pins both the original and Task SHA-256 digests, so changes to either require explicit review. Task-specific tests cover authorization, wake, immutable revisions and reference-counted preset disposal; profile tests cover dispatch, waiting, restart and completion through the replacements.

The duplication gate excludes only the two copied source trees. Their duplication is the selected isolation mechanism, while the parity test detects additions beyond the reviewed Task changes. All independently implemented Task packages remain in the repository duplication scan.

The per-file coverage gate includes independently implemented Task providers, schemas, authentication, HTTP parsing, event decoding, scheduling and resource policies. Instrumented composition tests execute the real HTTP gateway, SQLite engine, Session providers and Fetch client together at the normal 100% threshold. The copied Agent Loop remains excluded because its canonical package owns coverage and source parity pins the copy; the Task-owned preset source remains excluded until its moved suite reaches the threshold. Launcher entry and asset-serving code retain process-level profile validation.

This decision implements the provider-isolation portion of the [Task Profile proposal](../../proposed/architecture/2026-09-09-task-profile.md). Business-plugin repositories and their external-system adapters remain separate work.

Restored plugin fibers have a release pass independent of the first retirement promise. A blocked cleanup may finish through a later administrative retry, so retaining only a success handler on the original promise would leak the recovered fiber. The scheduler retries release after durable retirement completion, and host teardown awaits the shared release promise. The shipped-profile test crashes a waiting execution, removes its Loader entry, blocks recovery cleanup, then verifies that administrative retry releases the restored plugin.

## Alternatives considered

**Modify the shared providers.** Rejected because task admission and immutable revision retention do not belong to ordinary profiles, and the requested isolation requires the original module source to remain unchanged.

**Copy the complete Session and Agent type systems.** Rejected because two independent implementations would split module-private state and runtime type identity. Subclassing preserves the shared Session and Agent objects while replacing only their service providers.

**Publish a second preset Typert protocol.** Rejected because both packages implement the same `agentPresets/*` endpoints. One generated protocol identity avoids build-time endpoint conflicts and keeps existing clients compatible.

**Store Task lifecycle events in Session JSONL.** Rejected because SQLite already owns task lifecycle, scheduling, and recovery. Keeping JSONL conversation-only avoids changing the released Session event vocabulary and removes a cross-store state mirror.

## Consequences

- Base and Web behavior stays independent of Task Profile; selecting Task Profile changes the five provider implementations through Loader composition.
- The Task Agent Loop copy must follow compatible upstream Agent Loop changes. The parity test makes unexpected drift fail locally. The Task-owned preset provider follows upstream changes only through explicit review.
- SQLite and JSONL retain separate commit points. Durable inbox identities and operation receipts repair incomplete delivery without claiming a cross-store transaction.
- Authorization protects supported Task Profile entry paths among trusted in-process plugins. It is not a sandbox against a plugin that directly mutates a Session object it already holds.
