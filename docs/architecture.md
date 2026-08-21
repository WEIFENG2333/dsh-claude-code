# 架构

## 目标

本项目把 Claude Code 的模型可见表面作为 DSH 的一个独立 Agent Preset 提供。Standard 等既有模式保持原样；provider、模型选择、认证、权限、沙箱和会话仍由 DSH 宿主负责。

## 组成

| 模块 | 责任 |
| --- | --- |
| `cordis.patch.yml` | 挂载模式注册器和 HTTP WebFetch provider |
| `presets/claude-code/` | 定义独立的 Claude Code Agent 组装及其底层 DSH 工具能力 |
| `src/index.ts` | 向 Web 注册 preset；在 headless profile 中直接安装同一 Agent 表面 |
| `src/agent.ts` | 在 preset scope 内注册完整系统提示词、初始上下文和 26 个 Claude 工具 |
| `src/generated/claude-code-baseline.ts` | 保存 Claude Tap 提取的系统块、工具 schema、初始上下文和稳定协议事实 |
| `src/tools/` | 把 Claude 工具参数和返回内容适配到 DSH capability、嵌套工具调用或受控本地状态 |
| `src/adapter.ts`、`src/request.ts` | 保留可单独使用和回归测试的 Anthropic Messages 精确构造器，不由 bundle 默认注册 |

## 模式隔离

宿主插件只注册一个只读 preset 根目录，不注册全局模型 adapter，也不修改 DSH 的默认模型或全局系统提示词。Web 会话只有选择 `claude-code` preset 后，才会加入该 preset 的常驻 scope；Standard 会话看不到其中的提示词、工具和监听器。

headless profile 没有 preset 选择器。宿主插件检测到 `headlessStartup` 后，会把相同的 Agent 表面注册到该 profile 的全局 agent 层，以保留命令行用法。

## 模型路由

主请求完全复用 DSH 当前选中的 provider 和 model。插件不保存独立 API key，也不创建默认 provider。Claude 的 `WebFetch` 会产生一次辅助模型调用；它从调用会话已经记录的请求头读取 provider/model，因此也会跟随 Web 中的模型切换。

这意味着 Claude Code 模式可以运行在 DSH 已支持的不同协议上。系统提示词和工具 schema 保持捕获基准，最终 HTTP 字段、流式格式、重试和认证则由对应 provider 决定。`src/adapter.ts` 仍用于验证捕获的 Anthropic 请求布局，但不再覆盖 DSH 的正常模型体系。

## 提示词与工具

每个 agent 在第一次组装提示词时冻结自己的工作目录、git 状态、平台、shell、指令文件和 memory 目录。模型名由 DSH 每一步的模型选择变量插入，因此切换 provider 不需要重建插件配置。

Claude 工具先按捕获 JSON Schema 校验输入。Read、Write、Edit、Bash、Web、Skill、Agent、job 和 Workflow 等工具通过 DSH 工具注册表再次派发，从而继续经过 DSH 的策略、沙箱、日志和 provider；cron、wakeup、worktree、Notebook、DesignSync 和 onboarding 等缺少直接对应能力的功能由插件按会话或工作区维护。RemoteTrigger 读取 Claude Code 的本地 OAuth 文件，只向固定的 Anthropic API 地址发送凭据，令牌不会进入模型上下文、命令行或工具结果。

底层 DSH 工具与 Claude 工具同时注册在 preset scope 中，但系统提示词组装阶段只向模型公开捕获的 26 个 Claude schema。嵌套派发仍能访问被隐藏的 DSH 工具。Claude 账号、MCP、LSP 或实验开关动态加入的工具不进入静态公共基准。

## 生成基线

`scripts/extract-baseline.mjs` 只接受包含工具的 Claude Code 主请求，并把工作目录、git 状态、日期、设备与会话身份、私有指令等运行时内容替换为 token。生成文件只能由新的 Claude Tap trace 更新，不能手工修改。
