# dsh-claude-code

`dsh-claude-code` 是 DeepSeek Harness（DSH）的 Claude Code 兼容插件。它以本机 Claude Code `2.1.233.067` 的 Claude Tap 实测请求为基线，在 DSH 中复现首轮 Anthropic Messages 请求、系统提示词、初始上下文、31 个工具定义及对应的核心工具行为，并默认通过 `deepseek-v4-flash` 运行。

当前基线已用同一工作目录中的 Claude Code 与 DSH 分别抓取，并在只归一化日期、设备 ID、会话 ID和代理记录路径差异后通过整个主请求的深度相等比较。权限确认界面、Claude 托管服务和 DSH 尚未提供的语义能力不属于这一精确请求保证；详见[兼容性说明](docs/compatibility.md)。

## 要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- DeepSeek Harness `0.1.0-rc.7`
- 一个可用的 `DEEPSEEK_API_KEY`
- 可选的本地语言服务器；插件会自动探测 `gopls`、`rust-analyzer`、`typescript-language-server`、`pyright-langserver` 和 `clangd`

## 安装

把插件安装到现有 DSH profile：

```sh
dsh plugin --profile headless add github:WEIFENG2333/dsh-claude-code
```

设置 API key 并运行：

```sh
export DEEPSEEK_API_KEY='your-api-key'
dsh --profile headless '检查当前项目并修复测试失败'
```

插件 bundle 会自动完成以下组合：

- 将默认 provider 和模型切换为 `deepseek-claude-code` / `deepseek-v4-flash`
- 使用 DeepSeek 的 Anthropic 兼容端点
- 替换 DSH 系统提示词和工具 schema
- 加载 Claude Code 风格的 `CLAUDE.md`、rules 和 auto-memory 首轮上下文
- 挂载 HTTP WebFetch provider 和可自动探测的本地 LSP provider

如果需要固定语言服务器，可在 profile 的 `cordis.patch.yml` 中覆盖插件条目：

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

## 已复现的表面

- 首轮请求字段及顺序：`model`、`messages`、`system`、`tools`、`metadata`、`max_tokens`、`thinking`、`context_management`、`output_config`、`stream`
- 三段系统提示词、当前日期提醒、agent/skill catalog 和运行时环境段
- 当前 31 个 Claude Code 工具 schema，保持捕获顺序和 JSON 字段不变
- Read、Write、Edit、Bash、Web、Skill、Workflow、Notebook、Task、Agent、工作树、定时任务、监控、DesignSync、LSP 等工具的 DSH 适配
- Claude 风格的工具输入校验错误与主要文本返回格式

详细映射和已知差异见[兼容性说明](docs/compatibility.md)，内部组成见[架构文档](docs/architecture.md)。

## 开发与复验

```sh
corepack enable
pnpm install
pnpm verify
```

更新 Claude Code 基线时，不要直接编辑 `src/generated/claude-code-baseline.ts`。先用 Claude Tap 获取新 trace，再运行：

```sh
pnpm baseline:extract -- <claude-trace.jsonl>
pnpm capture:compare -- <claude-trace.jsonl> <dsh-trace.jsonl>
```

完整流程和敏感数据注意事项见[抓取与验证](docs/capture-and-verification.md)。原始 trace、凭证、机器指纹和私有指令文件不得提交。

## 参考

- [DeepSeek：在 Claude Code 中使用 DeepSeek API](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/)
- [Claude Tap](https://github.com/WEIFENG2333/claude-tap)
- [用于行为研究的 Claude Code 源码镜像](https://github.com/yasasbanukaofficial/claude-code)

## 许可证

[MIT](LICENSE)
