# Agent Note: Task Profile CI surface for fork pull requests

Status: implemented

English | [中文](2026-09-28-task-profile-fork-ci-surface.zh.md)

## Problem

Fork repositories contributing distinct runtime profiles (such as the durable Task subsystem and `--profile task`) inherit the full upstream CI workflow in `.github/workflows/ci.yml`. Running the full upstream matrix across 8,000+ tests, all packages, native Windows lanes, multi-version Node matrices, and Python runtimes consumes excessive runner time and frequently hangs or exhausts memory on standard hosted runners lacking enterprise-fleet labels (`dsh-ubuntu-24-04-16core`). Upstream harness code is already validated upon upstream synchronizations; fork PR validation only needs to test the newly introduced profile module while enforcing the exact same standards (static gates, typechecks, lints, clone detection, 100% test coverage, and session snapshot replay) applied to upstream profiles.

## Decision

Introduce a narrowed CI surface controlled by `DSH_CI_SURFACE=task-profile`, automatically activated on pull requests targeting the fork repository (`ggyy0124-cell/deepseek-harness`).

When `DSH_CI_SURFACE=task-profile` is active:
1. `node-24` (static analysis): Executes `pnpm run check:ci:static` with task source isolation, every shared upstream static gate (`ciSharedStaticGates()`, including the unknown-cast, license, package metadata, and entrypoint checks), the quick documentation-standard gates (`docQuickLeafGates()`), Typert contracts, typechecking, Oxlint rules, the module graph, and Task Profile scoped duplication detection via `duplication:task-profile`. A spec fails when upstream adds a shared or quick documentation gate the Task surface lacks.
2. `node-24-coverage` (unit & coverage): Executes `pnpm run check:ci:coverage` scoped directly to `packages/task/*/src` and task bundles, enforcing 100% per-file branch, statement, and function coverage within seconds.
3. `node-24-consumers` (build & snapshot replay): Replays the recorded Task Profile session snapshot (`snapshots/task/task.snapshot.ts`), executes Task Profile acceptance suites (`apps/cli/tests/profiles/task`), and verifies built artifacts, publint, NodeNext declarations, and package invariants under `DSH_EXAMPLE_MODE=lib`.
4. Upstream-only full monorepo jobs (`node-24-bench`, `node-compat`, `python-sdk`, `python-runtime`, and native Windows lanes) skip on `task-profile` PRs.
5. Runner tags gracefully select standard GitHub-hosted `ubuntu-24.04` instead of enterprise-only labels when executing on fork repositories.
6. The required PR branch protection check (`all-checks-passed`) evaluates the success of the active Task Profile jobs instead of failing on skipped monorepo lanes.

## Alternatives considered

**Running the full monorepo suite on fork PRs.** Rejected because standard hosted runners exhaust memory on whole-repo coverage and stall indefinitely on unavailable enterprise runner labels.

**Disabling CI on the fork entirely.** Rejected because fork changes must satisfy the same stringent quality invariants, typecheck standards, 100% coverage thresholds, and snapshot replay guarantees as upstream profile additions.

## Consequences

Pull requests in the fork repository finish automated CI gates in roughly 1 to 2 minutes on standard GitHub-hosted runners with full coverage and static validation, while upstream repository runs retain their complete exhaustive multi-platform matrix unchanged.
