# dsh-claude-code

[![CI](https://github.com/WEIFENG2333/dsh-claude-code/actions/workflows/ci.yml/badge.svg)](https://github.com/WEIFENG2333/dsh-claude-code/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

让 DeepSeek Harness（DSH）以接近 Claude Code 的方式工作。

安装这个插件后，DSH 会使用 Claude Code 的系统提示词和工具，并通过 `deepseek-v4-flash` 完成编码任务。你可以让它阅读和修改文件、执行命令、搜索网页、拆分任务，以及理解和跳转代码。

插件同时支持命令行和 DSH Web，不需要修改 DSH 源码。

> 本项目不是 Anthropic 官方项目。Claude Code 是 Anthropic 的产品和商标。

## 主要功能

- 使用 Claude Code 的系统提示词和 31 个工具
- 自动读取项目中的 `CLAUDE.md`、规则和记忆文件
- 支持文件编辑、命令执行、网页搜索、任务拆分、工作流和代码跳转
- 默认使用 DeepSeek 的 `deepseek-v4-flash`
- 同时支持命令行和 Web

当前版本以 Claude Code `2.1.233`、DeepSeek Harness `0.1.0-rc.7` 和 31 个 Claude Code 工具为兼容目标。除日期、设备 ID、会话 ID 等每次运行都会变化的内容外，第一次发给模型的请求体已经与 Claude Code 逐项比较一致。

## 使用方法

### 准备

你需要：

- Node.js `^22.19.0` 或 `>=24.0.0`
- DeepSeek Harness `0.1.0-rc.7`
- 一个可用的 `DEEPSEEK_API_KEY`
- 建议使用 pnpm 10 或更高版本

### 命令行模式

安装插件：

```sh
dsh plugin --profile headless add -w github:WEIFENG2333/dsh-claude-code
```

进入要操作的项目，然后启动任务：

```sh
cd /path/to/project
export DEEPSEEK_API_KEY='your-api-key'
dsh --profile headless '检查这个项目并修复测试失败'
```

### Web 模式

Web 使用独立配置，需要单独安装一次：

```sh
dsh plugin --profile web add -w github:WEIFENG2333/dsh-claude-code
```

从项目目录启动：

```sh
cd /path/to/project
export DEEPSEEK_API_KEY='your-api-key'
dsh web
```

浏览器打开 <http://127.0.0.1:3080>，选择当前项目，并使用“标准模式 / Standard mode”创建新会话。

安装或升级插件后，需要重启 `dsh web`。为了让工作目录和 `CLAUDE.md` 与 Claude Code 保持一致，建议从目标项目根目录启动 Web，并在页面中选择同一个目录。

### 为什么安装命令有 `-w`

`-w` 表示把插件安装到当前 DSH profile。它不会全局安装插件，也不会修改你的代码项目。缺少它时，pnpm 可能会报告 `ERR_PNPM_ADDING_TO_ROOT`。

## 检查是否安装成功

```sh
dsh plugin --profile web list
dsh web --dump-config | grep -E 'dsh-claude-code|deepseek-v4-flash'
```

输出中出现 `dsh-claude-code` 和 `deepseek-v4-flash`，说明插件已经加载。

安装时可能出现 peer dependency warning。只要安装命令和 `--dump-config` 成功，这些 warning 不影响插件使用。

## 需要知道的限制

- Claude Code 的权限选择界面没有复刻，文件和命令权限仍由 DSH 管理。
- 少数依赖 Claude 云端服务的功能使用本地替代实现。
- 部分高级 LSP 和 Workflow 操作暂不支持，调用时会返回明确错误。
- 工具的实际输出会受到操作系统、命令、网络和项目内容影响，不保证每个字符都与 Claude Code 相同。

详细的工具对应关系和差异见[兼容性说明](docs/compatibility.md)。

## 更多文档

- [兼容性说明](docs/compatibility.md)
- [项目架构](docs/architecture.md)
- [抓取与验证](docs/capture-and-verification.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## 参考

- [DeepSeek：在 Claude Code 中使用 DeepSeek API](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/)
- [Claude Tap](https://github.com/WEIFENG2333/claude-tap)
- [Claude Code 源码镜像](https://github.com/yasasbanukaofficial/claude-code)

## 许可证

[MIT](LICENSE)
