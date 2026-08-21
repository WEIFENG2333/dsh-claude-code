# 兼容性说明

## 基准

| 项目 | 当前目标 |
| --- | --- |
| Claude Code | `2.1.234.f09`（本机 CLI 显示 `2.1.234`） |
| DeepSeek Harness | 正式发布的 `>=0.1.1-rc.1 <0.2.0`（已验证 `0.1.1-rc.2`） |
| 模型 | 复用 DSH 当前会话选择 |
| 工具 schema | 26 个内置工具，捕获顺序与 JSON 字段保持一致 |
| 模型可见表面 | 系统提示词和工具表面与捕获基准一致 |

## 请求保证

默认 bundle 不注册 LLM adapter。系统提示词、Claude 初始上下文和有序工具 schema 由插件组装，`model`、消息序列化、认证、token 参数、流式格式与 provider 专用字段由当前 DSH provider 构造。工作目录、git 状态、平台、shell、内核、日期、Claude 指令和 memory 目录来自每个 agent 的启动环境，而不是硬编码为捕获机器的内容。

因此插件保证的是 Claude Code 的模型可见语义，不保证 DeepSeek、Anthropic、OpenAI 等不同协议生成相同 HTTP JSON。使用 Anthropic Messages provider 时，字段会尽量保持相同含义；`src/adapter.ts` 和 `src/request.ts` 仍保留捕获请求的精确构造与回归测试，但不会由安装 bundle 自动接管 DSH 的模型路由。

## Profile 与模型

当前正式版 DSH 不支持普通插件新增 Web Agent Preset，因此插件不提供独立模式，也不依赖 DSH fork。它把 Claude 表面安装到目标 profile 的全局层；Web 使用 Standard 模式，headless 直接运行。需要保留未经修改的 Web 行为时，应使用另一个未安装本插件的 profile。

模型选择仍属于 DSH。主请求和 WebFetch 辅助请求都沿用当前会话的 provider/model，安装插件不会修改默认模型。

## 工具映射

| 工具组 | 工具 | 实现 |
| --- | --- | --- |
| 文件与 shell | Read、Write、Edit、Bash、NotebookEdit | DSH fs/shell 工具；补充 Claude 行号、图片/PDF、返回文本与 notebook cell 语义 |
| Web 与扩展 | WebSearch、WebFetch、Skill、Workflow | DSH web/skill/workflow；WebFetch 再用当前模型回答页面问题 |
| Agent 与消息 | Agent、ListAgents、SendMessage | DSH subagent/control；维护 Claude 后台状态投影 |
| 后台任务 | TaskOutput、TaskStop | DSH background job/subagent |
| 调度与监控 | CronCreate、CronDelete、CronList、ScheduleWakeup、Monitor | session 内 timer、agent followup 和 DSH 后台 shell |
| 工作树 | EnterWorktree、ExitWorktree | git worktree 与 session cwd 映射，删除前检查提交和未提交修改 |
| 协作输出 | PushNotification、ReportFindings、ShareOnboardingGuide | 本机通知、工作区 findings 文件和本地 onboarding 存储 |
| 设计 | DesignSync | 本地项目/计划/文件/asset 状态机，写删操作受 finalized plan 限制 |
| 远程例程 | RemoteTrigger | 使用 Claude Code 本地 OAuth 访问固定的 Anthropic remote-trigger API |

## 已知差异

- DSH 的通用 runtime-context 消息结构与 Claude Code 原生客户端不完全相同；精确 Anthropic adapter 会使用捕获布局，默认 provider 路径以语义兼容为目标。
- 按需求暂不复制 Claude Code 的权限选择 UI、allow/deny 规则、hook 审批和交互式确认流程；实际安全行为仍由 DSH profile 的 sandbox/approval 配置决定。
- Claude 账号连接器、MCP、LSP 和实验开关可能为原生客户端动态增加工具；公共基准不固化这些机器专属工具。
- `Workflow.resumeFromRunId` 尚无 DSH 对应能力，会明确失败；新 workflow、内联脚本和路径脚本可运行。
- DesignSync 是受约束的本地兼容 backend，不连接 Claude 的托管 design 服务。ShareOnboardingGuide 同样使用本地存储，没有 Claude 云端 short-code 服务。
- PushNotification 在 Linux 上通过可选的 `notify-send` 执行；没有该命令时仍安全返回，但不会产生系统通知。
- Monitor 使用 DSH background job；它不模拟 Claude 客户端把每一行进程输出主动插入聊天 UI 的呈现层行为，输出可通过 TaskOutput 获取。
- Cron 和 ScheduleWakeup 目前是 session 进程内状态，进程退出后消失；`CronCreate.durable` 尚未持久化，recurring cron 最长运行七天。cron parser 支持标准五字段语法的常用范围、列表、步长和通配符，不承诺复现所有第三方 cron 扩展。
- Agent subtype、model 和 isolation 参数会尽可能映射到 DSH subagent，但 DSH provider 不具备的调度提示不会改变其执行引擎。
- RemoteTrigger 依赖本机 Claude Code 的有效 claude.ai 登录；插件不会刷新过期 OAuth token，而会提示用户通过 Claude Code 重新登录。
- 返回文本以可观测的 Claude Code 源码行为和实测为准，但 DSH provider 的底层错误详情、平台路径、命令输出和网络结果天然依赖执行环境，不属于逐字节稳定保证。

## 升级规则

Claude Code 更新后，只有新的 Claude Tap 主请求可以改变生成基线。若 schema 新增工具或 DSH capability 发生变化，应同时更新工具实现、兼容性表、单元测试、真实 API 矩阵和首轮请求对比证据。
