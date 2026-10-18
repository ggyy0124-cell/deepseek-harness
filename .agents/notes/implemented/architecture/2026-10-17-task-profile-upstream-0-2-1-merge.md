# Agent Note: Task Profile adaptation to the upstream 0.2.1 merge

Status: implemented

English | [中文](2026-10-17-task-profile-upstream-0-2-1-merge.zh.md)

## Problem

The fork merged upstream `deepseek-ai/deepseek-harness` from `dsh-v0.2.0-rc.1` through `dsh-v0.2.1-rc.2`. Five upstream changes reached Task replacement providers, Task presets, the Task application, or the Task CI surface. Delegation became managed child activations: `subagent` and `subagent_fork` return a child id immediately, the runtime delivers each child's closing message to its parent as a settled-child notice that wakes another parent turn, `backgroundMode` and `enableRunInBackground` no longer exist, and local subagents require the `working-directory` service. The JSONL persistence package exports a function plugin and keeps its backend class private, so the Task subclass that authorized Session writes no longer compiled. Runtime invariant plugins and every `./invariant` export were removed. The shared webserver refuses wildcard listen addresses such as `0.0.0.0`, which Task intranet access used. The Agent Loop refreshes provider context at request admission, retains resources until every Agent finishes teardown, and replaced the `{{cwd}}` prompt variable with Session working directories.

## Decision

A Task model operation waits for its parent Agent to settle instead of for one turn. After the correlated turn ends, Task Local repeats the upstream SDK wait: it awaits parent idleness, joins progressing children through `subagents.waitForChildren`, and returns only when no child was joined and the Session gained no event since that idle observation. Children inherit the operation's authority, so a settled-child notice wakes a parent turn inside the same operation. The operation's answer is the final assistant text of the last turn that ended before the next Task input. A settled child may continue (`agents.resume`, which `send_message` uses for a settled child) only inside the model operation that created it and within the Run's live-child limit. Cancellation stops and releases the parent's descendants with `subagents.drainDescendants` under the cancellation authority, and cleanup awaits that release before it requires every child to have settled.

Task presets keep following the Web declarations. The reviewed Task difference is `maxDepth: 1` on both delegation rows and the disabled workflow rows; the preset parity test admits nothing else. Base's working-directory, `working_directory` tool, remote-access, and DeepSeek Search and Fetch rows stay mounted in Task Profile, as in Web.

The shared `dsh-host-webserver` now refuses wildcard listen addresses, so `--host` accepts `127.0.0.1` or one concrete IPv4 or IPv6 address of a local interface, and `0.0.0.0` exits at flag parsing with the upstream reason. As in the Web fence, the gateway accepts the listen address as a browser origin without a `--trusted-host` entry; startup prints that address, and `--launch-link --host <address>` issues a link for it ([intranet login](../feature/2026-10-09-task-web-intranet-password-login.md)).

`dsh-task-session-persistence-jsonl` mounts the shared JSONL plugin under an isolated `sessionPersistence` key and provides a delegating `SessionPersistence` under the ordinary key for exactly the backend's lifetime. `create` and write `open` check Task Session authority before they delegate. Unloading the row removes the authorized provider before the backend, so consumers unload while the backend still holds their handles.

`dsh-task-agent-loop` takes the upstream Agent Loop through a three-way merge against `dsh-v0.2.0-rc.1`. The Task changes, namely the authority checks, `wake()`, the typed inbox wire state, and module identity, remain its only differences, and the source-copy test pins the refreshed digests. The Task `./invariant` companion and the README statements about invariant companions are removed with the upstream registry. The Task CI surface drops the removed built-package invariant gate, serializes the Task Web build after the Web build in the build graph, and lists `ci-unit` among the modes it does not use.

## Alternatives considered

**Keep foreground tool results with a Task-owned delegation tool.** Rejected because it would copy `dsh-tool-subagent` outside source parity and make Task presets diverge from Web, while the upstream runtime already exposes the joins a Task operation needs.

**Confirm the operation after the correlated turn and let notices arrive later.** Rejected because a notice-woken turn would run after the operation released its authority, so children and their result delivery would outlive the business stage that owns them.

**Disable the working-directory rows in Task Profile.** Rejected because local subagents require the service; disabling only the tool would make Task Agents differ from Web Agents without a Task-specific reason.

**Keep listening on `0.0.0.0` for intranet access.** Rejected because it requires changing the shared webserver's load-time check, a protected upstream module, and contradicts its reason: every interface would expose code execution to each network the host joins.

**Keep subclassing the JSONL backend through a source import.** Rejected because the class is private by design; the `sessionPersistence` service is the supported extension point.

## Consequences

- Task Runs follow the managed delegation contract: a delegation returns a child id, answers arrive as settled-child notices, and the model-visible tool descriptions and working-directory context changed.
- One model operation can include several parent turns; `stage.model()` returns the answer of the last one.
- This build appends `working-directory/change` events, which earlier Task builds refuse to read. Returning a deployment to an earlier build is limited to Sessions this build has not written.
- Cancellation closes delegation admission for the cancelled parent Agent until cleanup disposes it.
- An intranet deployment replaces `--host 0.0.0.0` with the host's intranet address; existing `--trusted-host` values keep working, and the listen address no longer needs one.
- The JSONL wrapper keeps the shared backend's storage, listing, and teardown behavior; its only Task logic is the authorization check.
