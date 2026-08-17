# Changelog

本项目按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 记录用户可见变化；首个稳定版本前允许调整内部 API。

## [Unreleased]

### Added

- 基于 Claude Code `2.1.233.067` Claude Tap trace 的三段系统提示词、初始上下文和 31 个工具 schema 基线。
- DeepSeek Anthropic 兼容 adapter，默认使用 `deepseek-v4-flash`。
- DSH 文件、shell、web、skill、workflow、subagent、job、LSP 和工具注册表适配。
- Task、cron、wakeup、worktree、Notebook、DesignSync、onboarding 和 findings 的 Claude 兼容实现。
- 首轮请求精确比较、敏感内容扫描、单元测试和 GitHub 安装所需的已构建 `lib/`。
