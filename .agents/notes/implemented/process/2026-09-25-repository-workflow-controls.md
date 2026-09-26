# Agent Note: Repository workflow controls

Status: implemented

English | [中文](2026-09-25-repository-workflow-controls.zh.md)

## Problem

The repository's required pull-request jobs depended on enterprise runner labels that are not available in every repository copy. A fork also inherited an automatic upstream merge workflow and had no manual route for an unsigned Windows package or a GitHub Packages release. The weighted approval policy did not recognize two maintainers as two-point reviewers.

## Decision

The required Linux and Windows jobs in [CI](../../../../.github/workflows/ci.yml) use GitHub-hosted runners when their failover variables are unset. The hosted consumer and coverage jobs use smaller worker and gate budgets than dedicated runners so process-heavy fixtures can complete within their declared deadlines. The Windows tools-catalog compiler fixture takes the coverage lane's configured test budget instead of overriding it with 30 seconds. The Python wide-structure hostile-peer fixture raises its execution ceiling to account for coverage instrumentation on lower-concurrency hosted runners. The JSON storage backend retries transient Windows file replacement errors (`EACCES`, `EBUSY`, `EPERM`) with bounded backoff, and the session projection cache cross-version fixture awaits the manual write flush so concurrent file locks do not drop the rewritten record. The npm resolution benchmark retries directory removal with bounded backoff so asynchronous file handle release on Windows runners does not fail with `EPERM`. The headless DeepSeek defaults fixture waits for the title request before finishing the response stream and raises its stream idle timeout to 1 second so event loop latency on hosted runners does not trigger spurious retries. The `enterprise` value selects the former dedicated runner labels; `selfhosted` and `blacksmith` retain their explicit routing. The Cloudflare preview runs only in `deepseek-ai/deepseek-harness`, and trusted release rehearsals allow that repository as well as `deepseek-harness/deepseek-harness` on the self-hosted pool. The automatic upstream merge workflow is absent, so synchronizing a fork requires an explicit Git operation.

The [Issue policy](../../../../.github/workflows/issue-policy.yml) and [Issue lifecycle](../../../../.github/workflows/issue-lifecycle.yml) workflows request Project App credentials only in the repositories that own the Project configuration. If enabled in a fork, their jobs succeed without attempting to mint a token for another repository's App installation. A fork without this Project integration may also disable the workflows in its Actions settings.

The [approval policy](../../../../.github/review-ownership/approval-policy.json) assigns `ggyy0124-cell` and `yvonluo` two points when they have write or admin access and are not the pull-request author. Manual workflows build an unsigned Windows x64 desktop artifact and publish a verified dsh release to GitHub Packages. The publisher serializes writes, uses the existing ordered release script, skips only versions with identical integrity, and fails on other registry errors. Publishing the `@deepseek-ai` scope still requires credentials authorized for that namespace; a fork's `GITHUB_TOKEN` alone does not grant it.

## Alternatives considered

**Keep enterprise labels as the implicit CI default.** This leaves pull requests queued when a repository lacks access to those labels; an explicit `enterprise` value keeps the option for deployments that have them.

**Keep automatic upstream synchronization.** An unattended merge can alter the fork's default branch without the same review as its other changes. Maintainers can fetch and merge upstream explicitly.

**Publish tarballs with an error-swallowing shell loop.** This would report success after a rejected or partially completed publication. The existing release script verifies integrity and preserves package order.

## Consequences

Default CI can run without private enterprise runners, but hosted jobs may take longer. Fork synchronization is manual, and fork Issue workflows do not enforce the upstream Project policy. A weighted approval still requires a reviewer with current repository write access, and authors cannot approve their own pull requests. The GitHub Packages workflow does not publish from a fork unless its credential is authorized for the `@deepseek-ai` namespace.
