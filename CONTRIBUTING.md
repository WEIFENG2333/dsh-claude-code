# 贡献指南

## 开始

```sh
corepack enable
pnpm install
pnpm verify
```

项目使用 ESM、严格 TypeScript 和 LF 行尾。代码按 request adapter、运行时环境、工具通用层和具体工具域拆分；新增行为应优先复用 DSH capability 或嵌套工具调用，避免在兼容层重复实现 DSH 已拥有的执行引擎。

## 修改要求

- 每个行为变更添加聚焦测试。
- 修改 README/JSDoc/兼容性说明，使文档与行为同步。
- 保持工具 schema 的名称、顺序、description 和 input schema 不变，除非新的 Claude Tap trace 证明 upstream 漂移。
- `src/generated/claude-code-baseline.ts` 只能由 `pnpm baseline:extract` 生成。
- 运行 `pnpm verify`，并提交同步生成的 `lib/`；GitHub 安装路径不能依赖用户本地编译器。
- 对模型可见或 provider 组合变更，执行 Claude/DSH 首轮抓取比较和至少一项真实 API smoke。

## 敏感数据

不要提交 API key、认证头、raw trace、HTML viewer、session 数据、机器指纹、私有指令、auto-memory、用户名或用户目录绝对路径。抓取和 tarball smoke 必须在仓库外的隔离目录执行。更多要求见[安全策略](SECURITY.md)和[抓取流程](docs/capture-and-verification.md)。

## 提交前

```sh
pnpm verify
git diff --check
git status --short
```

审阅生成基线和构建产物的 diff，不要用格式化或批量重写掩盖协议变化。
