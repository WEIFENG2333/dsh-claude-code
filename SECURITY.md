# 安全策略

## 报告问题

如果问题会泄露凭证、私有 prompt、trace、工作区文件或允许越权命令执行，请使用 GitHub Security Advisory 私下报告，不要先创建公开 issue。报告中提供最小复现，所有 key、token、用户名、设备 ID、会话 ID、私有路径和业务代码都应脱敏。

## 信任模型

本插件复现的是代码 agent 工具表面，会读取和修改文件、执行 shell、启动语言服务器和子 agent、访问网络，并可创建或删除 git worktree。它只应在受信任的工作区和合适的 DSH sandbox/approval profile 中运行。

当前版本按项目范围不实现 Claude Code 的权限 UI 和 hook 审批。安装插件不会关闭 DSH 自身的 sandbox 或 approval；profile 管理者必须根据运行环境选择 `read-only`、`workspace-write` 或明确授权的更高权限模式。

## 凭证

- 通过 `DEEPSEEK_API_KEY` 或 DSH credentials provider 提供 key，不要写入 `cordis.patch.yml`、源码、测试 fixture 或命令历史。
- 子进程依赖 DSH 的环境清理规则，不应隐式继承模型 API 凭证。
- Claude Tap trace 视为敏感凭证材料，即使代理页面看起来只展示 prompt。
- 发布前运行 `pnpm secrets:check`，并人工审阅生成文件、文档、构建产物和暂存 diff。

## 支持范围

安全修复只针对当前主分支和最新发布版本。旧 Claude Code 基线或旧 DSH release candidate 不承诺单独回移植。
