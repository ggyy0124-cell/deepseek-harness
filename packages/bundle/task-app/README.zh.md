---
description: "dsh-task-app：持久任务配置、执行与恢复。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-task-app

[English](README.md) | 中文

## 概述

在 Base 上启动 Task 引擎与经过认证的 REST/SSE 网关。业务插件、Task Web UI 和原生客户端应用属于后续集成范围。定时工作需要服务进程持续运行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

使用 `pnpm dsh --profile task` 启动后端。数据库（含已记录的 preset 版本）与 Session JSONL 保存到 DSH 主目录的 `tasks` 目录中，与 Web Profile 隔离。网关默认绑定本机 3081 端口，可通过 `--port` 修改。启动输出 API 基础地址 `/api/task/v1/`，不签发凭据或打开浏览器。`/` 和 `/index.html` 返回 404。未安装业务插件时没有业务定义。

本组合包在 `presets/` 下声明 Web preset，并保持派发在前台进行、禁用异步 workflow 启动。随附的编码 preset 允许特殊或普通任务的父 Agent 在已准入的模型轮次中自行决定是否调用前台进程内子 Agent；不要求创建子 Agent。`task-local` 默认通过 `childConcurrency` 将每个 Run 的并发子 Agent 限为四个；每个子 Agent 保留独立 Session，并须在父轮次结束前完成。

管理操作也使用此 Profile：

```sh
pnpm dsh --profile task --token-create
pnpm dsh --profile task --token-revoke DEVICE_ID
pnpm dsh --profile task --backup /absolute/new-backup
pnpm dsh --profile task --restore /absolute/backup
```

`--token-create` 只输出一次可撤销的 API Bearer 凭据，调用者通过 `Authorization: Bearer <token>` 提交。备份前须停止 Task 宿主；排他所有者锁会拒绝仍在运行的宿主。恢复先校验摘要和 SQLite 完整性，再发布到空 Task 数据目录，重写保留预设的位置、标记资源句柄需要重新核实，并替换事件流身份。凭据和外部系统状态不随之恢复。复制的工作树再次使用前需要修复仓库登记。这些命令不会启动 Web 服务器或任务调度器。

#### 后台服务示例

这些模板不会自动安装。请将全部绝对路径替换为已安装的 `dsh`、受支持 Node 的目录、工作目录及持久化主目录。先建立私有日志目录：标准输出服务地址。服务管理器的强制终止期限应晚于 Task 配置的停机期限。

Linux 用户服务（`~/.config/systemd/user/dsh-task.service`）：

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

审核 Linux 单元后，可用 `systemctl --user enable --now dsh-task` 启用；退出登录后继续运行需要启用用户 lingering。macOS 将 plist 保存到 `~/Library/LaunchAgents/local.dsh.task.plist`，通过 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.dsh.task.plist` 加载；LaunchAgent 需要用户已登录。离线备份前应停用或卸载服务，避免自动重启重新占用数据库锁。这些示例不阻止机器睡眠。强制终止可能留下结果不确定的外部操作，插件在恢复时核对。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

[补丁](cordis.patch.yml)禁用共享 Session、Agent、JSONL 持久化、Agent Loop 与 Agent Preset 条目，再为这些服务键插入 Task 专用提供方。补丁还组合本地任务提供方、REST 网关、派发消费者。共享 Agent Preset Typert 产物仍是唯一 RPC 协议描述，并通过替代 `agentPresets` 服务解析调用。

[Task REST 网关](../../task/task-api-gateway/README.zh.md) 通过未修改的 Host WebServer 在 `/api/task/v1` 提供服务。此 Profile 不提供前端资源。业务插件提供执行阶段与配置 Schema，不携带前端模块。REST 协议、Fetch SDK 以及浏览器和设备认证继续供后续客户端使用。

</details>


不发布运行时不变量插件；Task 提供方负责记录检查，HTTP 注册在对应操作中校验。
-----

<a id="further-exploration"></a>
## 延伸阅读

[Task 包组](../../../packages/task/README.zh.md)介绍职责划分；[提供方隔离决策](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.zh.md)说明替代实现。

-----

<a id="model-experience"></a>
## 模型体验

通过业务插件和任务 Session 适配器间接影响模型；它们负责模型指令与工具使用。

#### KV Cache 影响

本包不直接修改请求前缀；所选 preset 与业务提示决定缓存复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 此 Bundle 不包含业务插件、Task Web UI、原生客户端应用或操作系统服务安装器。任务在配置的宿主启动后恢复执行。

<a id="dev-note"></a>
### 开发备注

None.
