# 架构

## 目标

本项目在不修改 DSH agent loop 的前提下，通过 bundle patch、LLM adapter、系统提示词扩展点和工具注册表复现 Claude Code 的模型可见表面。捕获数据与运行时数据严格分离：版本相关但与机器无关的内容进入生成基线，工作目录、内核、git 状态、日期、设备 ID、会话 ID、私有指令和 memory 在进程启动时重建。

## 组成

| 模块 | 责任 |
| --- | --- |
| `cordis.patch.yml` | 把兼容 adapter、HTTP WebFetch provider 和本地 LSP provider 组合进现有 DSH profile |
| `src/generated/claude-code-baseline.ts` | 保存从 Claude Tap trace 提取的系统块、工具 schema、初始上下文、稳定请求默认值和协议头 |
| `src/request.ts` | 捕获运行环境、替换基线模板并按 Claude Code 的字段顺序构造 Anthropic 请求 |
| `src/instructions.ts` | 按 Claude Code 的优先顺序读取 managed、user、project、local 和 auto-memory 指令 |
| `src/adapter.ts` | 把 DSH 消息转换为 Claude Code wire messages，处理并行 tool result、reasoning/signature 和 SSE 响应 |
| `src/index.ts` | 注册 adapter、完整系统提示词和 31 个 Claude 工具 |
| `src/tools/` | 将 Claude 工具参数和返回文本适配到 DSH capability、工具调用或受控的本地状态 |
| `src/lsp-runtime.ts` | 创建 DSH LSP Service Definition，探测本地 server 并挂载 stdio provider |
| `src/web-fetch-provider.ts` | 让 bundle 可解析地转发到 DSH 维护的 HTTP fetch provider |

## 请求构造

插件启动时冻结一份运行环境快照，包括工作目录、git 状态、平台、shell、内核版本、模型和 memory 目录。每次模型调用从 DSH 的已记录消息重建请求；首轮再插入日期/指令块和 agent catalog。工具列表必须与生成基线深度相等，否则请求构造会直接失败，防止 DSH 的默认工具意外改变 Claude 可见 schema。

adapter 保留捕获请求的对象键顺序和稳定协议字段。DSH 的相邻并行工具结果会合并为一个 Anthropic `user` message；assistant 的 reasoning、签名和工具调用会保留，协调器消息中的私有 reasoning 不会伪装成用户内容。

## 工具实现

工具实现分成三类。

1. Read、Write、Edit、Bash、WebSearch、Skill、Agent、jobs、Workflow 等通过 DSH 工具注册表二次派发，因此继续使用 DSH 的文件系统、shell、web、subagent 和 worker provider。
2. Task list、cron、wakeup、worktree 当前目录和 background agent 投影是按 DSH session 隔离的进程内状态，并在插件卸载时清理 timer。
3. Notebook、DesignSync、onboarding guide 和 review findings 使用明确的工作区或配置根目录，并在写入前执行路径/计划约束。

所有 Claude 工具先按捕获的 JSON Schema 验证输入。验证错误和执行错误统一包装为 Claude Code 可识别的 `<tool_use_error>` 文本；正常结果由各工具适配器转换为捕获源码所使用的主要文本或 JSON 形式。

## LSP 组合

LSP wrapper 在自己的 Cordis 生命周期中创建 `ctx.lsp`，随后注册 DSH stdio providers。自动模式先使用 DSH subprocess provider 的清理后 PATH，再尝试常见用户级安装位置；成功解析的绝对路径在首次匹配查询时才启动 server 进程。显式的非空 `servers` 配置优先于自动探测，空字典仍视为未配置，以兼容 Schemastery 对可选字典的默认物化行为。

## 生成基线

`scripts/extract-baseline.mjs` 只接受含工具的 Claude Code 主请求。它验证三段 system 和两个首轮上下文 message，提取内部 Claude Code 版本，并把以下私有或易变值替换为 token：工作目录、git 标志、平台、shell、内核版本、模型、git 状态、指令内容和 memory 目录。只保留四个稳定协议头；认证、会话和机器指纹头不会写入源码。

生成文件是版本化协议事实，不是手写配置。任何修改都必须来自新的 trace，并同时通过精确请求比较、单元测试和真实 API 验证。
