# dsh-claude-code

[![CI](https://github.com/WEIFENG2333/dsh-claude-code/actions/workflows/ci.yml/badge.svg)](https://github.com/WEIFENG2333/dsh-claude-code/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

让 DeepSeek Harness（DSH）以接近 Claude Code 的方式工作。插件提供 Claude Code 的系统提示词、工具定义和主要工具行为，同时继续使用 DSH 自己的模型、权限、沙箱和运行环境。

插件只依赖正式发布的 DSH，不修改 DSH 源码，也不需要任何 fork。

> 本项目不是 Anthropic 官方项目。Claude Code 是 Anthropic 的产品和商标。

## 能做什么

- 提供基于 Claude Code `2.1.234` 的系统提示词和 26 个内置工具
- 支持读写文件、执行命令、网页搜索、子 Agent、后台任务、调度和工作流
- 自动读取项目中的 `CLAUDE.md`、规则和记忆文件
- 复用 DSH 已配置的模型，不限定 DeepSeek

## Web 使用方法

```sh
dsh plugin --profile web add -w github:WEIFENG2333/dsh-claude-code
dsh web
```

打开 <http://127.0.0.1:3080>，使用 Standard 模式创建会话，模型仍从 DSH 的模型列表中选择。

当前正式版 DSH 还不能由普通插件新增独立的 Web Agent 模式，因此页面中不会出现单独的“Claude Code 模式”。安装插件后，Claude Code 兼容表面会应用到这个 Web profile。

## 命令行使用方法

```sh
dsh plugin --profile headless add -w github:WEIFENG2333/dsh-claude-code
dsh --profile headless '检查这个项目并修复测试失败'
```

`-w` 是 pnpm 的 workspace-root 选项，表示把插件安装到当前 DSH profile，不是全局安装。

## 模型与协议

插件不自带或锁定模型。DeepSeek、Anthropic、OpenAI 兼容服务以及其他模型，只要已经能在 DSH 中正常使用，就可以继续使用。

认证、重试、流式响应和具体请求协议由所选 DSH provider 负责。使用 Anthropic Messages 协议时会尽量保持 Claude Code 的字段语义，但不要求请求体逐字节相同。

## 注意事项

- 安装或升级插件后需要重启 DSH。
- Claude Code 的权限选择界面没有复刻，实际权限仍由 DSH 管理。
- DesignSync 等少数云端功能使用本地替代实现；RemoteTrigger 需要本机已登录 Claude Code。
- 工具名称、顺序、描述和参数 schema 与当前捕获基准一致；操作系统和 provider 产生的输出可能不同。

更详细的范围与差异见[兼容性说明](docs/compatibility.md)。

## 参考

- [DeepSeek：在 Claude Code 中使用 DeepSeek API](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/)
- [Claude Tap](https://github.com/WEIFENG2333/claude-tap)

## 许可证

[MIT](LICENSE)
