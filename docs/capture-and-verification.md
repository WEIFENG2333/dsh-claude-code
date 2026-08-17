# 抓取与验证

## 安全要求

Claude Tap trace 可能包含 API key、认证头、私有 `CLAUDE.md`、auto-memory、设备 ID、会话 ID、用户名、绝对路径和源代码片段。所有抓取目录必须位于仓库外，不能提交 HTML、JSONL、日志或导出的完整 prompt。运行 `pnpm secrets:check` 不能替代人工检查。

## 1. 确认工具版本

在 Claude Code 和 Claude Tap 仓库分别记录版本或 commit。更新 Claude Tap 时先阅读 upstream 变更，再运行其测试；GitHub 网络操作按本机代理策略执行。

```sh
claude --version
git -C <claude-tap-repository> fetch --tags
git -C <claude-tap-repository> status --short --branch
```

## 2. 抓取 Claude Code 首轮请求

在一个无未提交修改的固定 git fixture 中运行。使用不会触发工具的确定性 prompt，减少后续调用噪声。

```sh
claude-tap run claude \
  -o <capture-root>/claude \
  --no-open \
  --no-update-check \
  -- \
  -p 'Reply with exactly OK. Do not use tools.'
```

从输出中记录包含 `tools` 的首个 JSONL trace。不要把 trace 复制到仓库。

## 3. 更新生成基线

```sh
pnpm baseline:extract -- <capture-root>/claude/<date>/<trace>.jsonl
pnpm verify
```

检查 diff 时重点确认版本号、工具数量/顺序、system block、初始 agent catalog、request defaults 和稳定协议头。生成器必须把所有机器值和私有指令替换为 `DSH_CLAUDE_CODE_*` token；如果新版 Claude 改变布局导致提取器失败，应先更新提取规则和测试，不能手工修补生成文件。

## 4. 抓取 DSH 首轮请求

把当前工作树安装到隔离 profile，使用同一个 fixture、prompt、模型和日期环境运行 DSH。

```sh
dsh plugin --profile headless add <path-or-github-spec>
claude-tap run dsh \
  -o <capture-root>/dsh \
  --no-open \
  --no-update-check \
  -- \
  --profile headless \
  'Reply with exactly OK. Do not use tools.'
```

## 5. 精确比较

```sh
pnpm capture:compare -- \
  <capture-root>/claude/<date>/<trace>.jsonl \
  <capture-root>/dsh/<date>/<trace>.jsonl
```

比较器删除 headers，因为 DSH 必须添加自身归因头且不同代理模式观察到的 header 集合不同；它还统一 `/anthropic` 路径前缀、日期、设备 ID 和会话 ID。除此以外，包含对象键顺序在内的整个含工具主请求必须深度相等。成功输出是 `normalized main request matches Claude Code exactly`。

## 6. 真实 API 工具矩阵

仅有请求相等不能证明工具可用。至少用 `deepseek-v4-flash` 完成以下真实调用，并检查模型确实调用目标工具而不是只复述 prompt：

- Read、Write、Edit、Bash 及后台 Bash 的 TaskOutput/TaskStop
- TaskCreate、TaskGet、TaskList、TaskUpdate
- Agent、ListAgents、SendMessage 及后台完成投影
- EnterWorktree、ExitWorktree 的 keep/remove/保护分支
- Workflow、WebSearch、WebFetch、Skill、NotebookEdit
- DesignSync 的项目、计划、写入和删除阶段
- CronCreate/CronList/CronDelete、ScheduleWakeup、Monitor
- ShareOnboardingGuide、ReportFindings、PushNotification
- LSP `goToDefinition`，使用已安装 server 的真实源码 fixture
- WaitForMcpServers 空等待分支

测试产生的文件、worktree、profile、trace 和 session 数据都应留在隔离临时目录；验证结束后按明确路径清理。不要在清理命令中使用未解析变量、宽泛 glob 或工作区根目录。

## 7. 发布前验证

```sh
pnpm verify
pnpm pack --pack-destination <temporary-directory>
```

从生成的 tarball 安装到一个全新的 DSH profile，再执行一次真实 API smoke。这样可以发现 workspace 软链接掩盖的缺失依赖、未提交 `lib/`、错误 exports 或缺失 bundle 文件。
