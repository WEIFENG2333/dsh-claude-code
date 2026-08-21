# Changelog

本项目按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 记录用户可见变化；首个稳定版本前允许调整内部 API。

## [Unreleased]

## [0.2.1] - 2026-08-21

### Changed

- 取消依赖未发布 DSH 扩展的独立 Web preset，改为只使用正式 DSH 接口的 profile 级兼容层。
- Web 使用内置 Standard 模式，不修改 DSH 源码、不写入用户 preset 目录，也不依赖 fork。
- 模型与 provider 改为复用 DSH 当前选择，不再默认注册 DeepSeek 专用 adapter 或修改默认模型。
- WebFetch 的辅助模型调用会跟随当前会话选择的 provider/model。
- Anthropic Messages 以提示词、工具和字段语义兼容为目标，不再把跨 provider 的 HTTP 字节级一致作为默认 bundle 保证。

### Added

- 基于 Claude Code `2.1.234.f09` Claude Tap trace 的三段系统提示词、初始上下文和 26 个内置工具 schema 基线。
- 可单独使用和验证的 DeepSeek Anthropic 兼容 adapter。
- DSH 文件、shell、web、skill、workflow、subagent、job 和工具注册表适配。
- cron、wakeup、worktree、Notebook、DesignSync、RemoteTrigger、onboarding 和 findings 的 Claude 兼容实现。
- 首轮请求精确比较、敏感内容扫描、单元测试和 GitHub 安装所需的已构建 `lib/`。
