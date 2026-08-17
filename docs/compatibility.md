# 兼容性说明

## 基准

| 项目 | 当前目标 |
| --- | --- |
| Claude Code | `2.1.233.067`（本机 CLI 显示 `2.1.233`） |
| DeepSeek Harness | `0.1.0-rc.7` |
| 模型 | `deepseek-v4-flash` |
| 工具 schema | 31 个，捕获顺序与 JSON 字段保持一致 |
| 首轮请求 | 归一化动态身份、日期、header 和代理路径后全量深度相等 |

## 请求保证

插件精确构造 `model`、`messages`、三段 `system`、有序 `tools`、`metadata`、`max_tokens`、`thinking`、`context_management`、`output_config` 和 `stream`。工作目录、git 状态、平台、shell、内核、日期、设备/会话标识、Claude 指令和 memory 目录来自当前运行环境，因此它们的值应与同机同目录的 Claude Code 相同，而不是硬编码为捕获机器的内容。

headers 不属于全量相等断言。插件发送捕获到的稳定 Anthropic 协议头，并保留 DSH 必需的客户端归因；认证和机器指纹由各自客户端生成，不能复制或提交。

## 工具映射

| 工具组 | 工具 | 实现 |
| --- | --- | --- |
| 文件与 shell | Read、Write、Edit、Bash、NotebookEdit | DSH fs/shell 工具；补充 Claude 行号、图片/PDF、返回文本与 notebook cell 语义 |
| Web 与扩展 | WebSearch、WebFetch、Skill、Workflow | DSH web/skill/workflow；WebFetch 再用当前模型回答页面问题 |
| Agent 与消息 | Agent、ListAgents、SendMessage | DSH subagent/control；维护 Claude 后台状态投影 |
| 任务 | TaskCreate、TaskGet、TaskList、TaskUpdate、TaskOutput、TaskStop | session 内任务表加 DSH background job/subagent |
| 调度与监控 | CronCreate、CronDelete、CronList、ScheduleWakeup、Monitor | session 内 timer、agent followup 和 DSH 后台 shell |
| 工作树 | EnterWorktree、ExitWorktree | git worktree 与 session cwd 映射，删除前检查提交和未提交修改 |
| 协作输出 | PushNotification、ReportFindings、ShareOnboardingGuide | 本机通知、工作区 findings 文件和本地 onboarding 存储 |
| 设计 | DesignSync | 本地项目/计划/文件/asset 状态机，写删操作受 finalized plan 限制 |
| 语言服务 | LSP | DSH LSP + stdio server 自动探测/显式配置 |
| MCP 启动 | WaitForMcpServers | 映射 DSH 在首轮前完成 MCP discovery 的启动语义 |

## 已知差异

- 按需求暂不复制 Claude Code 的权限选择 UI、allow/deny 规则、hook 审批和交互式确认流程；实际安全行为仍由 DSH profile 的 sandbox/approval 配置决定。
- 工具 schema 暴露 Claude Code 当前 9 个 LSP operation。DSH `0.1.0-rc.7` capability 只提供 `goToDefinition`、`findReferences`、`goToImplementation` 和 `hover`；`documentSymbol`、`workspaceSymbol`、`prepareCallHierarchy`、`incomingCalls`、`outgoingCalls` 会返回明确的 unsupported error。
- `Workflow.resumeFromRunId` 尚无 DSH 对应能力，会明确失败；新 workflow、内联脚本和路径脚本可运行。
- DesignSync 是受约束的本地兼容 backend，不连接 Claude 的托管 design 服务。ShareOnboardingGuide 同样使用本地存储，没有 Claude 云端 short-code 服务。
- PushNotification 在 Linux 上通过可选的 `notify-send` 执行；没有该命令时仍安全返回，但不会产生系统通知。
- Monitor 使用 DSH background job；它不模拟 Claude 客户端把每一行进程输出主动插入聊天 UI 的呈现层行为，输出可通过 TaskOutput 获取。
- Cron 和 ScheduleWakeup 是 session 进程内状态，进程退出后消失；recurring cron 最长运行七天。cron parser 支持标准五字段语法的常用范围、列表、步长和通配符，不承诺复现所有第三方 cron 扩展。
- Agent subtype、model 和 isolation 参数会尽可能映射到 DSH subagent，但 DSH provider 不具备的调度提示不会改变其执行引擎。
- WaitForMcpServers 的命名 server 分支只报告“已不在 pending”；当前 DSH 在首轮前完成 MCP discovery，插件不会重新实现 Claude 的异步 MCP 启动管理器。
- 返回文本以可观测的 Claude Code 源码行为和实测为准，但 DSH provider 的底层错误详情、平台路径、命令输出和网络结果天然依赖执行环境，不属于逐字节稳定保证。

## 升级规则

Claude Code 更新后，只有新的 Claude Tap 主请求可以改变生成基线。若 schema 新增工具或 DSH capability 发生变化，应同时更新工具实现、兼容性表、单元测试、真实 API 矩阵和首轮请求对比证据。
