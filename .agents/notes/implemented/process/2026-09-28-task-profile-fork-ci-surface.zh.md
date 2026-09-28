# Agent Note: Fork 仓库 PR 提交的 Task Profile CI 门禁表面

状态：implemented

[English](2026-09-28-task-profile-fork-ci-surface.md) | 中文

## 问题

贡献特定运行时 profile（如持久任务子系统与 `--profile task`）的 Fork 仓库继承了 `.github/workflows/ci.yml` 中的全量上游 CI 工作流。在缺乏企业级运行器标签（`dsh-ubuntu-24-04-16core`）的标准 GitHub 托管运行器上，运行涵盖 8000 多个测试、全部 monorepo 软件包、原生 Windows 通道、多版本 Node 矩阵与 Python 运行时的全量 CI 会耗费海量运行器时间，并频繁出现排队挂起或内存溢出（OOM）。上游 Harness 代码在同步上游版本时已完成检测并获得验证；Fork 仓库的 PR 检测仅需针对新增的 Task Profile 模块进行验证，同时必须保持与原仓库其它 profile 完全一致的检测标准（静态门禁、类型检查、代码风格、代码重复检测、100% 测试覆盖率及 session snapshot 快照回放）。

## 决策

引入由 `DSH_CI_SURFACE=task-profile` 控制的收窄 CI 门禁表面，在目标为 Fork 仓库（`ggyy0124-cell/deepseek-harness`）的 pull request 中自动激活。

当 `DSH_CI_SURFACE=task-profile` 激活时：
1. `node-24`（静态检查）：执行 `pnpm run check:ci:static`，涵盖任务代码隔离、约束规范、包依赖、Cordis 配置、包不变性、运行时闭包、加权审批策略验证、Typert 契约、类型检查、Oxlint 规范，以及针对 Task Profile 目录的专用克隆代码检测 `duplication:task-profile`。
2. `node-24-coverage`（单测与覆盖率）：执行直接限定于 `packages/task/*/src` 及任务组合包的 `pnpm run check:ci:coverage`，在数秒内达成并强制要求 100% 单文件分支、语句和函数覆盖率。
3. `node-24-consumers`（构建与快照回放）：在 `DSH_EXAMPLE_MODE=lib` 条件下回放 Task Profile 的录制会话快照（`snapshots/task/task.snapshot.ts`），执行 Task Profile 验收测试集（`apps/cli/tests/profiles/task`），并验证构建产物与包不变性。
4. 仅限上游的整个 monorepo 任务（`node-24-bench`、`node-compat`、`python-sdk`、`python-runtime` 及原生 Windows 通道）在 `task-profile` PR 下跳过。
5. 在 Fork 仓库中执行时，运行器标签平滑回退到标准 GitHub 托管的 `ubuntu-24.04`，避免因企业独有标签导致无限期排队。
6. PR 分支保护必需的汇总判决任务（`all-checks-passed`）评估活跃 Task Profile 任务的执行成功状态，而不会因跳过无关上游任务而失败。

## 备选方案

**在 Fork PR 上运行完整的 monorepo 全量测试。** 拒绝：因为标准托管运行器在全库覆盖率收集时会发生内存溢出，且因缺少企业运行器标签而停滞挂起。

**完全禁用 Fork 仓库的 CI。** 拒绝：因为 Fork 代码必须满足与上游新增 profile 相同严苛的质量不变性、类型检查标准、100% 覆盖率门槛和快照回放保证。

## 影响

Fork 仓库中的 pull request 在标准 GitHub 托管运行器上只需大约 1 至 2 分钟即可完成全套门禁（含完整覆盖率与静态验证），同时原上游仓库的完整多平台测试矩阵保持不变。
