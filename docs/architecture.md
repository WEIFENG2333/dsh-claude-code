# 架构

## 目标

本项目把 Claude Code 的模型可见表面作为 DSH profile 的兼容层提供。provider、模型选择、认证、权限、沙箱和会话仍由正式发布的 DSH 负责，插件不修改 DSH 源码。

## 组成

| 模块 | 责任 |
| --- | --- |
| `cordis.patch.yml` | 在安装该插件的 profile 中挂载兼容层和 HTTP WebFetch provider |
| `src/index.ts` | 解析配置并安装 Claude Code 表面 |
| `src/agent.ts` | 注册完整系统提示词、初始上下文和 26 个 Claude 工具 |
| `src/generated/claude-code-baseline.ts` | 保存 Claude Tap 提取的系统块、工具 schema、初始上下文和稳定协议事实 |
| `src/tools/` | 把 Claude 工具参数和返回内容适配到 DSH capability、嵌套工具调用或受控本地状态 |
| `src/adapter.ts`、`src/request.ts` | 保留可单独使用和回归测试的 Anthropic Messages 精确构造器，不由 bundle 默认注册 |

## Profile 级挂载

当前正式版 DSH 没有让普通插件注册 Web Agent Preset 的公开接口，因此插件不创建独立模式。安装后，Claude Code 的提示词和工具表面注册在该 profile 的全局层；Web 继续使用内置模式选择器，并以 Standard 模式作为受支持入口。headless 同样直接使用这套表面。

这项实现只使用 DSH 已发布的插件和 capability 接口，不写入用户 preset 目录，也不依赖 DSH fork。需要保留原始 Web 行为时，应使用一个没有安装本插件的 profile。

## 模型路由

主请求完全复用 DSH 当前选中的 provider 和 model。插件不保存独立 API key，不创建默认 provider，也不修改 DSH 的默认模型。Claude 的 `WebFetch` 辅助调用从当前会话读取 provider/model，因此会跟随 Web 中的模型选择。

系统提示词和工具 schema 保持捕获基准，最终 HTTP 字段、流式格式、重试和认证由对应 DSH provider 决定。`src/adapter.ts` 仅用于验证捕获的 Anthropic 请求布局，不覆盖 DSH 的正常模型体系。

## 提示词与工具

每个 agent 在第一次组装提示词时冻结自己的工作目录、git 状态、平台、shell、指令文件和 memory 目录。模型名由 DSH 每一步的模型选择变量插入，因此切换 provider 不需要重建插件配置。

Claude 工具先按捕获 JSON Schema 校验输入。Read、Write、Edit、Bash、Web、Skill、Agent、job 和 Workflow 等工具通过 DSH 工具注册表再次派发，从而继续经过 DSH 的策略、沙箱、日志和 provider；缺少直接对应能力的功能由插件按会话或工作区维护。RemoteTrigger 读取 Claude Code 的本地 OAuth 文件，只向固定的 Anthropic API 地址发送凭据，令牌不会进入模型上下文、命令行或工具结果。

系统提示词组装阶段只向模型公开捕获的 26 个 Claude schema。嵌套派发仍能访问 Standard 模式提供的底层 DSH 工具。Claude 账号、MCP、LSP 或实验开关动态加入的工具不进入静态公共基准。

## 生成基线

`scripts/extract-baseline.mjs` 只接受包含工具的 Claude Code 主请求，并把工作目录、git 状态、日期、设备与会话身份、私有指令等运行时内容替换为 token。生成文件只能由新的 Claude Tap trace 更新，不能手工修改。
