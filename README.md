# dsh-claude-code

[![CI](https://github.com/WEIFENG2333/dsh-claude-code/actions/workflows/ci.yml/badge.svg)](https://github.com/WEIFENG2333/dsh-claude-code/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

为 DeepSeek Harness（DSH）增加一个独立的“Claude Code 模式”。它使用从 Claude Code 捕获并适配的系统提示词、工具定义和主要工具行为，同时继续使用 DSH 自己的模型、权限、沙箱和运行环境。

安装后，Web 中原有的 Standard、Code 等模式不会被覆盖。新建会话时选择“Claude Code 模式”，再像平常一样选择 DSH 中已经配置好的模型即可。

> 本项目不是 Anthropic 官方项目。Claude Code 是 Anthropic 的产品和商标。

## 能做什么

- 提供 Claude Code 的系统提示词和 26 个内置工具
- 支持读写文件、执行命令、网页搜索、子 Agent、后台任务、调度和工作流
- 自动读取项目中的 `CLAUDE.md`、规则和记忆文件
- 复用 DSH 的模型配置，不限定 DeepSeek，也不额外接管默认模型

当前兼容基准为 Claude Code `2.1.234`。工具名称、顺序、描述和参数 schema 与捕获基准保持一致；不同模型协议的最终 HTTP 请求由对应的 DSH provider 生成，因此不承诺跨协议逐字节相同。

## Web 使用方法

安装到 Web profile：

```sh
dsh plugin --profile web add -w github:WEIFENG2333/dsh-claude-code
```

重启 Web：

```sh
dsh web
```

打开 <http://127.0.0.1:3080>，创建新会话时选择“Claude Code 模式”，模型仍从 DSH 的模型列表中选择。

## 命令行使用方法

headless profile 没有模式选择器，因此安装后会直接使用 Claude Code 表面，模型仍取自该 profile 的 DSH 配置：

```sh
dsh plugin --profile headless add -w github:WEIFENG2333/dsh-claude-code
dsh --profile headless '检查这个项目并修复测试失败'
```

`-w` 是 pnpm 的 workspace-root 选项，表示把插件装进当前 DSH profile，不是全局安装。

## 模型与协议

插件不自带或锁定模型。DeepSeek、Anthropic、OpenAI 兼容服务以及其他模型，只要已经能在 DSH 中正常使用，就可以继续用于 Claude Code 模式。

Claude Code 的提示词和工具表面由本插件负责；认证、重试、流式响应和具体请求协议由所选 DSH provider 负责。使用 Anthropic Messages 协议时会尽量保持 Claude Code 的字段语义，但以兼容和可用为目标，不要求请求体每个字节完全相同。

## 注意事项

- 需要使用包含“插件提供 Agent Preset”支持的新版 DSH；旧版 Web 会明确提示升级。
- Claude Code 的权限选择界面没有复刻，实际权限仍由 DSH 管理。
- DesignSync 等少数云端功能使用本地替代实现；RemoteTrigger 需要本机已登录 Claude Code。
- 安装或升级插件后需要重启 DSH。

更详细的范围与差异见[兼容性说明](docs/compatibility.md)。

## 参考

- [DeepSeek：在 Claude Code 中使用 DeepSeek API](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/)
- [Claude Tap](https://github.com/WEIFENG2333/claude-tap)

## 许可证

[MIT](LICENSE)
