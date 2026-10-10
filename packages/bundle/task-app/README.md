---
description: "dsh-task-app: durable task configuration, execution, and recovery."
kind: "package-bundle"
---

# @deepseek-ai/dsh-task-app

English | [中文](README.zh.md)

## Summary

Launch the Task engine, the authenticated REST/SSE gateway and the [Task Web client](../../../apps/task-web/README.md) over Base. Business plugins and native client applications are deferred integrations. The host must remain running for scheduled work to start.

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

Launch the backend with `pnpm dsh --profile task`. Its database, including recorded preset revisions, and Session JSONL live under the DSH home’s `tasks` directory, isolated from Web Profile. The gateway binds loopback port 3081 by default; `--port` selects another port, and `--host 0.0.0.0` listens on all interfaces for [intranet access](#intranet-access). Startup prints the Web client address `/` and the API base address `/api/task/v1/` without issuing a credential or opening a browser; sign in with `--launch-link`. Browser navigations to paths without a built file receive the client's `index.html`, existing files are served directly, and other missing paths return 404. An installation without business plugins has no business definitions.

The bundle declares the Web presets under `presets/` with delegation kept in the foreground and asynchronous workflow starts disabled. The shipped coding presets let a special or ordinary Task Agent choose whether to call foreground in-process subagents during an admitted model turn. No child is required. `task-local` limits them to four live children per Run by default through `childConcurrency`; each child retains its own Session and must finish before the parent turn settles.

Administration also uses this profile:

```sh
pnpm dsh --profile task --token-create
pnpm dsh --profile task --token-revoke DEVICE_ID
pnpm dsh --profile task --launch-link
pnpm dsh --profile task --password-set
pnpm dsh --profile task --backup /absolute/new-backup
pnpm dsh --profile task --restore /absolute/backup
```

`--token-create` prints a revocable API bearer credential once; callers supply it in `Authorization: Bearer <token>`. `--launch-link` prints `{ "url", "expiresAt" }` for the host on `--port`: a single-use browser launch secret in the URL fragment (`#launch=`), valid for 60 seconds, that the Task Web client posts to `/auth/exchange`. A running host accepts it because the gateway rereads the shared credential document. Set the administration row's `publicOrigin` to the gateway's `publicOrigin` when browsers use another origin. Stop the Task host before backup; an exclusive owner lock rejects a running host. Restore validates hashes and SQLite integrity before publishing into an empty Task data directory, rewrites retained preset locations, marks resource handles for reconciliation and replaces the event-stream identity. Credentials and external-system state are not restored. A copied worktree requires repository registration repair before reuse. `--password-set` stores the browser sign-in password described below. These commands do not start the web server or task scheduler.

<a id="intranet-access"></a>
#### Intranet access

Start the host with `--host 0.0.0.0 --trusted-host <authority>` so browsers on other machines can open it; repeat `--trusted-host` for each address they use, such as `10.0.0.5` or `task.lan:3081`. A bare host means the `--port` value. Listening on all interfaces without a trusted host is refused at startup, and startup prints one Web address per trusted host. Requests with any other Host header return 403.

To sign in without a launch link, enable the gateway's password login in the profile patch. A patch replaces the row's whole configuration, so it restates `attachmentRoot` and the `trustedHosts` wiring:

```yaml
- id: task-api-gateway
  config:
    attachmentRoot: !!js ctx.dshHomePath('tasks/attachments')
    trustedHosts: !!js ctx.taskStartup.trustedHosts
    passwordLogin:
      enabled: true
      username: operator
```

Then run `pnpm dsh --profile task --password-set` on the host. From a terminal it reads the password twice without echo; with piped input it reads standard input up to one final newline. It stores the value in the `TASK_WEB_PASSWORD` credential (the administration row's `passwordRef`, which must match the gateway's `passwordLogin.passwordRef`) and prints `{ "reference", "configured" }`; the next login uses the new value without a restart. The launch link remains the administrator entry for a forgotten password or a locked login. Plain HTTP carries the password and session cookie unencrypted, so limit the port to intranet ranges with the host firewall and run the host under a dedicated system account.

#### Background service examples

These templates are not installed automatically. Replace every absolute path with the installed `dsh` executable, its supported Node directory, workspace and persistent home. Create private log directories first. Keep supervisor termination later than the configured Task shutdown deadline.

Linux user service (`~/.config/systemd/user/dsh-task.service`):

```ini
[Unit]
Description=DSH Task

[Service]
Type=simple
WorkingDirectory=/absolute/workspace
Environment=DSH_HOME=/absolute/dsh-home
Environment=PATH=/absolute/node/bin:/usr/bin:/bin
ExecStart=/absolute/dsh/bin/dsh --profile task
Restart=on-failure
RestartSec=5
TimeoutStopSec=150
KillMode=control-group
UMask=0077

[Install]
WantedBy=default.target
```

macOS LaunchAgent:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>local.dsh.task</string>
  <key>ProgramArguments</key><array>
    <string>/absolute/dsh/bin/dsh</string><string>--profile</string>
    <string>task</string>
  </array>
  <key>WorkingDirectory</key><string>/absolute/workspace</string>
  <key>EnvironmentVariables</key><dict>
    <key>DSH_HOME</key><string>/absolute/dsh-home</string>
    <key>PATH</key><string>/absolute/node/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ExitTimeOut</key><integer>150</integer>
  <key>StandardOutPath</key><string>/absolute/private-logs/task.out</string>
  <key>StandardErrorPath</key><string>/absolute/private-logs/task.err</string>
</dict></plist>
```

After reviewing the Linux unit, `systemctl --user enable --now dsh-task` enables it. Running after logout requires user lingering. On macOS, save the plist under `~/Library/LaunchAgents/local.dsh.task.plist` and load it with `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.dsh.task.plist`; a LaunchAgent requires a logged-in user. Disable/unload the service before offline backup, or automatic restart may reacquire the database lock. These examples do not prevent machine sleep. Hard termination can leave uncertain external operations; plugins reconcile them on recovery.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The [patch](cordis.patch.yml) disables the shared Session, Agent, JSONL persistence, Agent Loop, and Agent Preset rows, then inserts Task-specific providers for those service keys. It also composes the local task provider, REST gateway, dispatch consumer. The shared Agent Preset Typert artifact remains the single RPC protocol description and resolves calls through the replacement `agentPresets` service.

The [Task REST gateway](../../task/task-api-gateway/README.md) serves `/api/task/v1` through the unchanged Host WebServer. The application entry claims the WebServer fallback for the built `@deepseek-ai/dsh-task-web-frontend` `dist/` ([`src/web.ts`](src/web.ts)); the index carries a same-origin content security policy and fingerprinted assets are cached as immutable. Business plugins provide executable stages and configuration schemas without frontend modules. The REST protocol, Fetch SDK and device authentication remain available for native clients.

</details>


No runtime invariant companion is published; Task providers own record checks, while HTTP registration is checked at its operations.
-----

<a id="further-exploration"></a>
## Further Exploration

[Task package group](../../../packages/task/README.md) explains ownership; the [provider-isolation decision](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.md) explains the replacements.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through business plugins and the task Session adapter, which own model instructions and tool use.

#### KV Cache effect

No direct prefix changes; the selected preset and business prompts determine cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle does not include business plugins, native client applications or an operating-system service installer. Task execution resumes when the configured host starts.

<a id="dev-note"></a>
### Dev Note

None.
