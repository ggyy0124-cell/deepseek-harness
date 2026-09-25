# Agent Note: 仓库工作流控制

Status: implemented

[English](2026-09-25-repository-workflow-controls.md) | 中文

## Problem

仓库必需的拉取请求任务依赖企业 Runner 标签，而其他仓库副本未必有权使用这些标签。Fork 还继承了自动合并上游的工作流，却没有手动构建未签名 Windows 包或向 GitHub Packages 发布的入口。加权审批策略也未将两位维护者列为两分审核者。

## Decision

[CI](../../../../.github/workflows/ci.yml) 中必需的 Linux 和 Windows 任务在故障转移变量未设置时使用 GitHub 托管 Runner。变量值 `enterprise` 选择原有专用标签；`selfhosted` 和 `blacksmith` 保留各自的显式路由。Cloudflare 预览仅在 `deepseek-ai/deepseek-harness` 运行；可信的发布预演也允许该仓库和 `deepseek-harness/deepseek-harness` 使用自托管池。自动合并上游的工作流已移除，因此同步 Fork 需要显式 Git 操作。

[审批策略](../../../../.github/review-ownership/approval-policy.json) 在 `ggyy0124-cell` 和 `yvonluo` 拥有写入或管理员权限且不是拉取请求作者时给予两分。手动工作流可构建未签名的 Windows x64 桌面产物，并将经过验证的 dsh 版本发布到 GitHub Packages。发布任务串行写入，使用现有的有序发布脚本，只跳过完整性相同的版本，并在其他注册表错误时失败。发布 `@deepseek-ai` 命名空间仍需获得该命名空间授权的凭据；Fork 自身的 `GITHUB_TOKEN` 不会自动获得此权限。

## Alternatives considered

**继续默认使用企业 Runner 标签。** 无权使用这些标签的仓库会让拉取请求持续排队；显式的 `enterprise` 值保留了有权限的部署继续使用它们的能力。

**保留自动同步上游。** 无人值守的合并可能绕过仓库其他变更的审查而修改 Fork 的默认分支。维护者可以显式获取并合并上游。

**通过吞掉错误的 Shell 循环发布压缩包。** 注册表拒绝发布或只完成部分发布后，该方式仍会报告成功。现有发布脚本会校验完整性并保持包的顺序。

## Consequences

默认 CI 不再依赖私有企业 Runner，但托管任务可能耗时更久或占用不同的 Runner 容量。Fork 同步改为手动。加权审批仍要求审核者当前拥有仓库写入权限，作者不能批准自己的拉取请求。除非凭据获准访问 `@deepseek-ai` 命名空间，否则 GitHub Packages 工作流无法从 Fork 发布。
