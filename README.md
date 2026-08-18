# dsh-claude-code

[![CI](https://github.com/WEIFENG2333/dsh-claude-code/actions/workflows/ci.yml/badge.svg)](https://github.com/WEIFENG2333/dsh-claude-code/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

在 DeepSeek Harness（DSH）中复现 Claude Code 的首轮模型请求、系统提示词、工具定义和主要工具行为，并默认通过 `deepseek-v4-flash` 执行。

这不是一套相似风格的提示词，也不是 Claude Code 的 UI 主题。插件从 Claude Tap 实际抓取的 Claude Code 请求生成版本化基线，通过 DSH 的 LLM adapter、系统提示词和工具扩展点，让模型看到相同的 Anthropic Messages 请求结构；31 个 Claude 工具则映射到 DSH capability 或受约束的本地实现。

> 本项目不是 Anthropic 官方项目。Claude Code 是 Anthropic 的产品和商标。

## 兼容基线

| 项目 | 当前目标 |
| --- | --- |
| Claude Code | `2.1.233.067`（CLI 显示 `2.1.233`） |
| DeepSeek Harness | `0.1.0-rc.7` |
| 默认模型 | `deepseek-v4-flash` |
| API 协议 | DeepSeek Anthropic 兼容端点 |
| 工具定义 | 31 个，保持捕获顺序和 JSON Schema 字段 |
| 首轮请求体 | 移除客户端专属 headers，并归一化运行时身份、日期和代理路径后全量深度相等 |

“首轮请求相等”指同一台机器、同一工作目录中的 Claude Code 与 DSH 主请求体在必要归一化后深度相等，包括对象键顺序。认证、会话和客户端归因 headers 由各自客户端生成，不属于相等断言；工具返回中的平台路径、命令输出、网络结果和 DSH provider 错误详情同样依赖实际运行环境。完整范围见[兼容性说明](docs/compatibility.md)。

## 快速开始

### 运行要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- DeepSeek Harness `0.1.0-rc.7`
- 可用的 `DEEPSEEK_API_KEY`
- 建议使用 pnpm 10 或更高版本安装 GitHub 插件
- 可选的本地语言服务器：`gopls`、`rust-analyzer`、`typescript-language-server`、`pyright-langserver` 或 `clangd`

### Headless

安装到 `headless` profile：

```sh
dsh plugin --profile headless add -w github:WEIFENG2333/dsh-claude-code
```

从要操作的项目根目录启动：

```sh
cd /path/to/project
export DEEPSEEK_API_KEY='your-api-key'
dsh --profile headless '检查当前项目并修复测试失败'
```

### Web

`headless` 和 `web` 是独立 profile；已经安装到 `headless` 不会自动影响 Web。先单独安装：

```sh
dsh plugin --profile web add -w github:WEIFENG2333/dsh-claude-code
```

从要操作的项目根目录启动 Web：

```sh
cd /path/to/project
export DEEPSEEK_API_KEY='your-api-key'
dsh web
```

打开 <http://127.0.0.1:3080>，选择与启动目录相同的 Workspace，保留“标准模式 / Standard mode”，然后创建新会话。插件会把新会话的默认 provider 和模型设置为 `deepseek-claude-code` / `deepseek-v4-flash`。

Web profile 安装或升级插件后必须重启 `dsh web`；验证首轮请求时应创建新会话，已经发过消息的旧会话不会重做首轮请求。插件在服务启动时冻结 Claude Code 风格的运行环境和指令快照，因此需要严格对齐首轮请求时，应从目标项目根目录启动一个 Web 服务，不要在该进程中切换到其他 Workspace。“极简模式 / Minimal mode”拥有另一份完整系统提示词，不适合本兼容插件。

端口被占用时可以指定其他端口：

```sh
dsh web --port 3081
```

### `-w` 是什么

DSH profile 目录本身是一个 pnpm workspace 根目录。`-w` 是 pnpm 的 `--workspace-root` 简写，表示明确允许把插件加入该 profile；它不会全局安装插件，也不会修改正在操作的代码项目。

### 确认插件已加载

```sh
dsh plugin --profile web list
dsh web --dump-config | rg 'dsh-claude-code|deepseek-v4-flash'
```

成功配置会包含 `dsh-claude-code`、provider `deepseek-claude-code` 和模型 `deepseek-v4-flash`。如果系统没有 `rg`，可以把第二条命令末尾替换为 `grep -E 'dsh-claude-code|deepseek-v4-flash'`。

## 复现了什么

| 维度 | 行为 |
| --- | --- |
| 请求协议 | 构造捕获到的 `model`、`messages`、`system`、`tools`、`metadata`、`max_tokens`、`thinking`、`context_management`、`output_config` 和 `stream` 字段，并保持字段顺序 |
| 系统提示词 | 复现三段系统内容、当前日期提醒、agent/skill catalog、运行环境、git 状态和 memory 路径 |
| 工作区指令 | 按 Claude Code 优先级加载 managed、user、project、local、rules 和 auto-memory 内容 |
| 工具定义 | 使用捕获生成的 31 个工具 schema；运行时工具表漂移会直接失败，而不是静默发送不同请求 |
| 会话转换 | 转换 DSH 消息，合并并行 tool result，并保留 reasoning、signature 和连续子 agent 对话 |
| 执行能力 | 通过 DSH 的文件系统、shell、Web、Skill、Workflow、subagent、job 和 LSP provider 执行 Claude 工具 |

31 个工具按用途分为：

- 文件与命令：`Read`、`Write`、`Edit`、`Bash`、`NotebookEdit`
- Web 与扩展：`WebSearch`、`WebFetch`、`Skill`、`Workflow`、`LSP`、`WaitForMcpServers`
- Agent 与任务：`Agent`、`ListAgents`、`SendMessage`、`TaskCreate`、`TaskGet`、`TaskList`、`TaskUpdate`、`TaskOutput`、`TaskStop`
- 调度与监控：`CronCreate`、`CronDelete`、`CronList`、`ScheduleWakeup`、`Monitor`
- 工作树与协作：`EnterWorktree`、`ExitWorktree`、`PushNotification`、`ReportFindings`、`ShareOnboardingGuide`、`DesignSync`

具体映射、返回语义和已知差异见[兼容性说明](docs/compatibility.md)，内部职责划分见[架构文档](docs/architecture.md)。

## 配置

安装 bundle 后，profile 会自动挂载兼容 adapter、HTTP WebFetch provider 和 LSP provider。常用配置如下：

| 配置项 | 默认值 | 作用 |
| --- | --- | --- |
| `provider` | `deepseek-claude-code` | DSH provider 名称 |
| `baseURL` | `https://api.deepseek.com/anthropic` | Anthropic 兼容 API 根地址 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | DSH credential reference |
| `model` | `deepseek-v4-flash` | 请求模型 |
| `maxTokens` | `32000` | 主请求最大输出 token |
| `contextWindow` | `1000000` | 向 DSH 声明的上下文容量 |
| `effort` | `max` | Claude Code reasoning effort |
| `requestTimeoutMs` | `600000` | 完整请求超时 |
| `webFetchMaxTokens` | `4096` | WebFetch 页面问答调用的输出上限 |
| `loadClaudeInstructions` | `true` | 是否加载 Claude 指令和 auto-memory |
| `claudeConfigDir` | `$CLAUDE_CONFIG_DIR` 或 `~/.claude` | Claude rules、memory 和用户指令目录 |
| `timeZone` | 系统时区 | 当前日期提醒使用的 IANA 时区 |
| `designRoot` | `.dsh/claude-design-projects` | 本地 DesignSync 数据目录 |
| `onboardingRoot` | `.dsh/claude-onboarding-guides` | 本地 onboarding guide 数据目录 |

可以在 profile 的 `cordis.patch.yml` 中按条目 `id` 覆盖配置。例如固定语言服务器：

```yaml
- id: claude-code-lsp-provider
  config:
    autoDetect: false
    servers:
      gopls:
        command: /opt/tools/gopls
        extensionToLanguage:
          .go: go
```

API key 应通过环境变量或 DSH credentials provider 提供，不要写进 `cordis.patch.yml`、源码、测试或提交记录。

## 当前限制

- 插件不复制 Claude Code 的权限选择 UI、allow/deny 规则、hook 审批和交互式确认流程；实际安全行为由 DSH profile 的 sandbox 和 approval 配置决定。
- Claude schema 中的 9 个 LSP operation 会全部呈现，但 DSH `0.1.0-rc.7` 仅执行其中 4 个；其余 operation 返回明确的 unsupported error。
- `Workflow.resumeFromRunId` 没有当前 DSH 对应能力；新 workflow、内联脚本和路径脚本可以执行。
- DesignSync 和 ShareOnboardingGuide 使用本地兼容存储，不连接 Claude 托管服务。
- Cron、ScheduleWakeup 和部分后台状态保存在当前进程内，服务退出后不会恢复。

这些限制以及平台相关差异的完整说明在[兼容性说明](docs/compatibility.md)中维护。

## 常见问题

### `ERR_PNPM_ADDING_TO_ROOT`

安装命令缺少 `-w`。使用 README 中带 `-w` 的完整命令；这是 DSH profile 安装路径与 pnpm workspace-root 检查之间的要求，不是仓库权限错误。

### 安装完成但出现 peer dependency warning

DSH profile 使用共享 capability 包，pnpm 可能报告插件 peer 未在 profile 根显式声明。先运行 `dsh web --dump-config` 或对应 profile 的 `--dump-config`；只要命令成功且输出包含插件条目，这些 warning 本身不表示加载失败。

### `MISSING_CREDENTIAL`

确保 `DEEPSEEK_API_KEY` 设置在启动 DSH 的同一个 shell 或服务进程中。修改环境变量后重启 DSH。

### Web 中提示词或工具不符合预期

重启 `dsh web`、新建会话、选择“标准模式”，并确认 Workspace 与启动 Web 时的目录一致。不要用旧会话判断首轮请求。

## 开发与复验

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` 依次执行严格 TypeScript 检查、lint、单元测试、构建和敏感信息扫描。GitHub 安装直接使用仓库中提交的 `lib/`，因此源码变更必须同步提交构建输出。

更新 Claude Code 基线时，不要手工编辑 `src/generated/claude-code-baseline.ts`。先在仓库外使用 Claude Tap 获取新 trace，再执行：

```sh
pnpm baseline:extract -- <claude-trace.jsonl>
pnpm capture:compare -- <claude-trace.jsonl> <dsh-trace.jsonl>
```

成功比较会输出：

```text
normalized main request matches Claude Code exactly
```

原始 trace 可能包含 API key、认证头、私有提示词、机器指纹、会话标识、绝对路径和代码，不得加入仓库。完整更新流程见[抓取与验证](docs/capture-and-verification.md)。

## 项目文档

- [兼容性说明](docs/compatibility.md)：请求保证、31 个工具的实现映射和已知差异
- [架构文档](docs/architecture.md)：bundle、adapter、请求构造、工具层、LSP 和生成基线
- [抓取与验证](docs/capture-and-verification.md)：Claude Tap 抓取、精确比较、真实 API 矩阵和发布验证
- [贡献指南](CONTRIBUTING.md)：修改约束、构建产物和提交前检查
- [安全策略](SECURITY.md)：敏感问题报告、信任模型和凭证处理
- [更新记录](CHANGELOG.md)

## 参考

- [DeepSeek：在 Claude Code 中使用 DeepSeek API](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/)
- [Claude Tap](https://github.com/WEIFENG2333/claude-tap)
- [用于行为研究的 Claude Code 源码镜像](https://github.com/yasasbanukaofficial/claude-code)

## 许可证

[MIT](LICENSE)
