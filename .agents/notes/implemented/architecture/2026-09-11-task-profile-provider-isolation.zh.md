# Agent Note: Task Profile 提供方隔离

Status: implemented

[English](2026-09-11-task-profile-provider-isolation.md) | 中文

## Problem

持久业务任务需要在等待确认与进程重启期间保留同一个 Session，同时阻止通用 Agent 控制在任务准入之外运行该 Session。不可变 preset 版本以及唤醒已持久化收件箱消息的操作也只属于任务执行。若把这些规则加入共享 Session、Agent、Agent Loop、JSONL 持久化与 Agent Preset 包，会改变所有 profile，并让普通会话依赖 Task 数据库。

## Decision

Task 应用补丁禁用五个共享提供方条目，再以新的 Loader 标识插入 Task 专用替代包。`dsh-task-session`、`dsh-task-agent` 与 `dsh-task-session-persistence-jsonl` 继承共享提供方并加入任务归属授权检查。`dsh-task-agent-loop` 与 `dsh-task-agent-presets` 复制共享实现，因为所需修改位于私有驱动及常驻挂载逻辑中。Base 与 Web Profile 继续挂载共享包，且这些包的源码保持不变。

Task SQLite 数据库是执行状态及执行到 Session 关系的权威。Session JSONL 只保存普通会话事件，并存放在 DSH 主目录的 `tasks/sessions` 目录中，使其他 Profile 的 Session 目录不会列出 Task Session。Task 阶段先持久化带唯一标识的收件箱消息，再唤醒 Task Agent；确认模型操作前，将该消息与已完成轮次关联。恢复流程在发布 Agent 前核对数据库关联及持久化记录。终态 Session 仍可读取；Task Profile 的修改、持久化写入、Agent 命令、恢复及任务父级创建路径必须具有提供方的异步 Session 授权。

业务定义注册会携带贡献它的插件的准确 Cordis Context。提供方把注册 effect 安装在该 Context 上，使多个插件 fiber 可以共存，同时限制每个 fiber 只能注册一个特殊定义。fiber 释放时会先关闭准入，并等待取消与清理完成，再释放旧的可执行定义。

模型取消回调显式进入所属 Session 的授权上下文。AbortSignal 监听器在调用方的异步上下文中执行，因此在已授权的模型操作中注册监听器，并不能为后续外部中止授予权限。Session 适配器将该回调交给具有授权的取消操作；回归测试从 Task 上下文外中断活动模型流，并检查其收据仍未确认。

替代 preset 提供方占用 subagent 派发所读取的共享 `agentPresets` 服务键。Task Profile 为该命名空间显式加载 `dsh-agent-preset-registry` 生成的 Typert 贡献，因此其 `list`、`read` 与 `select` 端点解析到 Task 实现。替代包不发布 Typert 贡献。上游已移除基于目录的共享包，因此 Task 包自行声明 preset 类型（[合并记录](2026-09-29-task-profile-upstream-0-1-7-merge.zh.md)）。

复制的 Agent Loop 具有可执行的一致性检查。未改变的源码在模块标识归一化后逐字节比较。每个获准不同的文件同时固定原文件与 Task 文件的 SHA-256 摘要，因此任一侧变化均需要显式审查。Task 专属测试覆盖授权、唤醒、不可变修订和按引用计数释放预设；profile 测试覆盖通过替换提供者完成派发、等待、重启和结束。

重复代码门禁只排除两个复制源码树。复制是本决策选择的隔离方式，而一致性测试会检测审核过的 Task 改动以外的新增差异。所有独立实现的 Task 包仍参与仓库重复代码扫描。

逐文件覆盖率门禁包含独立实现的 Task 提供者、schema、认证、HTTP 解析、事件解码、调度与资源策略。可插桩组合测试一起执行真实 HTTP 网关、SQLite 引擎、Session 提供者和 Fetch 客户端，并接受常规 100% 阈值。复制的 Agent Loop 仍被排除，由原始包负责覆盖率，并通过源码一致性检查约束副本；Task 持有的 preset 源码在迁入的测试达到阈值前仍被排除。启动器入口和静态文件服务代码保留进程级 Profile 验证。

本决策实现 [Task Profile 提案](../../proposed/architecture/2026-09-09-task-profile.zh.md)中的提供方隔离部分。业务插件仓库及其外部系统适配器仍属于独立工作。

恢复加载的插件 fiber 具有独立于首次卸载 Promise 的释放流程。阻塞的清理可能通过后续管理操作重试完成，因此只在最初 Promise 成功时释放，会遗留恢复加载的 fiber。调度器在持久化卸载完成后重试释放，服务退出等待共享的释放 Promise。内置 Profile 测试让等待中的执行崩溃、移除其 Loader 条目并阻塞恢复清理，再验证管理操作重试会释放恢复加载的插件。

## Alternatives considered

**修改共享提供方。** 不采用，因为任务准入与不可变版本保留不属于普通 profile，而且隔离要求原有模块源码保持不变。

**复制完整 Session 与 Agent 类型系统。** 不采用，因为两套独立实现会分裂模块私有状态与运行时类型身份。继承方式保留共享 Session 和 Agent 对象，只替换其服务提供方。

**发布第二份 preset Typert 协议。** 不采用，因为两个包实现相同的 `agentPresets/*` 端点。唯一生成协议标识可避免构建期端点冲突，并保持现有客户端兼容。

**在 Session JSONL 中保存 Task 生命周期事件。** 不采用，因为 SQLite 已负责任务生命周期、调度与恢复。JSONL 只保存会话，可避免改变已发布的 Session 事件词汇，也无需维护跨存储状态镜像。

## Consequences

- Base 与 Web 行为独立于 Task Profile；选择 Task Profile 时，Loader 组合会替换五个提供方实现。
- Task Agent Loop 副本需要跟随兼容的上游 Agent Loop 变更；一致性测试会使意外漂移在本地失败。Task 持有的 preset 提供方仅通过显式审查跟随上游变更。
- SQLite 与 JSONL 仍有独立提交点。持久收件箱标识与操作回执可修复未完成投递，但不宣称存在跨存储事务。
- 授权保护可信进程内插件之间受支持的 Task Profile 入口；它不是阻止插件直接修改其已持有 Session 对象的沙箱。
