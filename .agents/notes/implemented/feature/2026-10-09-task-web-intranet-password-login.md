# Agent Note: Task Web intranet access with a fixed account password

Status: implemented

English | [中文](2026-10-09-task-web-intranet-password-login.zh.md)

## Problem

The Task host served Task Web and the gateway only on `127.0.0.1`, and a browser could sign in only through `dsh --profile task --launch-link`, whose secret lives 60 seconds and must be carried from a shell on the host to each browser. A team that runs one Task host on an intranet machine for colleagues on other machines had no address those machines could open and needed shell access to the host for every new browser.

The supported deployment is one intranet machine reached by other intranet machines over plain HTTP at fixed addresses, with one shared account and password and no reverse proxy. The [client hosting decision](../architecture/2026-10-03-task-web-client-hosting.md) keeps authentication at the gateway, so the change lives in the Task startup flags, the gateway and the Task Web client.

## Decision

The three additions are opt-in. Without them the host listens on loopback, the gateway accepts only its current origin and Task Web offers only the launch link.

### Listen address and trusted hosts

`task-startup` accepts `--host 127.0.0.1` (default) or `--host 0.0.0.0`, the two values `dsh-host-webserver` supports, and a repeatable `--trusted-host <authority>`. `--host 0.0.0.0` without a trusted host exits at flag parsing, because no browser on another machine could pass the Host check. The shipped patch passes the flags into the gateway's `trustedHosts`; the gateway refuses the same misconfiguration at load for compositions that bypass the flags.

`trustedHosts` lists authorities (`host` or `host:port`; a bare host means the server port) accepted besides `publicOrigin` or the loopback origin, with the scheme of `publicOrigin` or `http`. `browserOrigins()` returns these origins; each request is matched to the origin whose authority equals its Host, and that origin decides the Origin check, request URL resolution and the cookie `Secure` attribute. Matching is exact and forwarded headers change nothing. Startup prints one Web address per trusted host. `--launch-link` keeps printing a loopback URL (or `publicOrigin`), never `0.0.0.0`.

### Password login

`passwordLogin.enabled` adds `POST /auth/login` with `{ "username", "password" }` and an exact trusted Origin. Success opens the same HttpOnly SameSite Strict cookie and CSRF session as `/auth/exchange`, through the same store and with the same `sessionTtlMs` of 30 days. The password is the value of the `passwordLogin.passwordRef` credential (default `TASK_WEB_PASSWORD`), read on every attempt and compared by digest in constant time, so a changed password applies to the next login without a restart. `PUT /credentials/{reference}` refuses that reference with `403 credential_reserved`; only `dsh --profile task --password-set` sets it, reading the password twice without echo from a terminal or once from piped standard input.

Failures count in memory per client address and per username. The attempt that reaches `maxFailures` (5) inside `failureWindowMs` (15 minutes) locks the address or username for `lockoutMs` (15 minutes), and locked attempts return `429 login_throttled` with `Retry-After`. An unconfigured password credential fails every login with 401 and logs `password_unconfigured`. Login diagnostics record the outcome and client address, never the submitted values. `passwordLogin.username` defaults to empty and is required when the login is enabled.

Unauthenticated `GET /auth/methods` reports `{ "password": boolean }`. Task Web reads it whenever it has no session and then shows a username and password form, with the launch-link command under a collapsed administrator entry for a forgotten password, an unconfigured credential or a lock.

### Configuration

| Owner | Field | Default |
|---|---|---|
| `task-startup` flags | `--host` / `--trusted-host` | `127.0.0.1` / none |
| `task-startup` flag | `--password-set` | administration command |
| gateway | `trustedHosts` | `[]` |
| gateway | `passwordLogin.enabled` / `username` / `passwordRef` | `false` / `''` / `TASK_WEB_PASSWORD` |
| gateway | `passwordLogin.maxFailures` / `failureWindowMs` / `lockoutMs` | `5` / `900000` / `900000` |
| administration | `passwordRef` | `TASK_WEB_PASSWORD`; must match the gateway's `passwordLogin.passwordRef` |

A profile patch replaces a row's whole configuration, so a patch that enables password login restates `attachmentRoot` and `trustedHosts: !!js ctx.taskStartup.trustedHosts`, as the [Task application README](../../../../packages/bundle/task-app/README.md#intranet-access) shows.

## Alternatives considered

**Remove the launch link.** Rejected: issuing it requires a shell on the host and read access to `DSH_HOME`, so it adds no network exposure, and it is the only recovery path for a forgotten password, a missing credential or a lock. Removing it would also rewrite the administration, gateway and browser acceptance tests without a security gain.

**Reverse proxy with TLS or single sign-on in front of a loopback Task host.** Not chosen for this deployment: it adds a component to install and maintain, and the deployment accepts plain HTTP on the intranet. It remains compatible: `publicOrigin` plus `trustedHosts` express a proxied origin without code changes.

**Client address allowlist without a password.** Rejected: a signed-in browser can trigger runs under the `danger-full-access` preset and replace ZenTao, Gerrit and model credentials, so every machine on the network would gain code execution on the host.

**A proxy that injects a device bearer token.** Rejected: `/auth/session` refuses bearer callers, so Task Web would not start, and an injected credential applies to every request through the proxy, leaving CSRF defense to the Origin check alone.

**A separate, shorter session lifetime for password logins.** Rejected by the deployment owner in favor of the existing 30-day `sessionTtlMs`; daily use outweighed the shorter exposure of a captured cookie.

**Accounts with individual passwords.** Deferred: one shared account meets the deployment, while per-user accounts need user administration, a principal per session and attribution of inputs and replies. The session store records one principal, so a later change can add users without changing the cookie format.

**Built-in TLS in `dsh-host-webserver`.** Deferred: the deployment accepts plain HTTP, and certificate configuration and renewal would change the WebServer package that every profile shares.

## Consequences

Intranet browsers open the host at a fixed address and sign in with one account; nobody needs a shell on the host except to set the password or to recover through the launch link.

A signed-in browser can run code on the host under the `danger-full-access` preset. The password, the host firewall limiting the port to intranet ranges and a dedicated system account are the barriers. Over plain HTTP anyone capturing intranet traffic can read the password and a 30-day session cookie, which carries no `Secure` attribute. All users share one principal, so inputs, replies and configuration changes are not attributable to a person. Restarting the host clears failure counters and locks, and a username lock also blocks the legitimate user until it expires.

Upstream DSH refuses `0.0.0.0` for the Web Profile on safety grounds; `task-startup` and the gateway diverge from that stance, so upstream syncs touching these files need manual merging.

Gateway unit tests cover trusted-host matching, scheme inheritance, password login, throttling, the reserved credential and load-time misconfiguration; `task-intranet-login.e2e.ts` covers `--password-set`, flag validation and login through a trusted host on the shipped profile; `password-login.e2e.ts` drives the Task Web form in a browser.
