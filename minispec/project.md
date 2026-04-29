# Project

AI Coding History — 记录 AI coding agent 对代码库的改动，提供 session / turn / 文件 / 方法 / 行级别的归因与历史视图，让用户看清 AI 改了什么、为什么改、改的过程。

工程骨架已就位（见 `packages/`），业务代码将随后续 change card 逐步落地。

## Stack

- Language: TypeScript 5.9.x（严格模式，`noUncheckedIndexedAccess`、`verbatimModuleSyntax`）
- Framework: Node.js monorepo，pnpm workspaces；子包 `@minspect/{core, collector, cli, ui, adapter-claude-code}`；UI 将于后续卡引入 Vite + React + Monaco
- Runtime: Node.js 20+（`.nvmrc` 指向 20 LTS；已验证兼容 Node 24）
- Package manager: pnpm 10.x（`packageManager` 字段锁定）
- Test: Vitest 2.x（根 `vitest.config.ts` + 各包 `--passWithNoTests`）
- Lint / Format: Biome 1.9.x（`biome.json` 根配置）
- Storage: SQLite（计划 `better-sqlite3`），后续按需接入 `sqlite-vec`
- AST: tree-sitter（多语言解析，卡 08 引入）
- 目标平台：Windows / macOS / Linux（首选验证平台 Windows）

## Commands

- Install: `pnpm install`
- Build: `pnpm -r build`
- Test: `pnpm -r test`
- Lint: `pnpm lint`
- Format: `pnpm format`

## Engineering Constraints

- **本地优先**：MVP 阶段所有数据、索引、UI 均在用户本机运行；除 LLM Explainer 按需外发 hunk 外，无强制对外网络调用。
- **Hook 必须快**：`minspect capture` 等 hook 入口要求"快进快出"，不得阻塞 agent；重活（AST / 行血缘 / LLM）一律推给常驻 collector。
- **事件模型是跨 agent 契约**：所有 adapter 输出统一 `Event` 形状；新增 agent 不应迫使核心 schema 变动。
- **内容寻址存储**：文件快照通过 `blobs` 表以 sha256 去重，避免为每次 edit 存两份全文。
- **Git 感知**：每条 edit 必须绑定 `branch` / `head` / `dirty`；commit 后通过 `commit_links` 表做事后关联。
- **LLM 调用可关**：Explainer 默认启用 Haiku；必须支持 BYO API key 与完全关闭开关，以覆盖隐私敏感场景。
- **跨平台**：Hook 命令禁止依赖 shell 特性，一律以可执行二进制/入口脚本方式调用，确保 Windows 可用。
- **依赖克制**：新增依赖需有明确理由；能用标准库解决的不引入第三方包。

## Non-Goals

- 团队 / 多人协作、权限模型、云端同步（MVP 不做；即便后续做也走独立 change）。
- 托管服务 / 账号体系。
- IDE 插件（Phase 3+，非本阶段目标；当前仅交付 Web UI）。
- 对完全不暴露 hook 的 agent（如闭源 Cursor）做深度归因——仅接到"有 diff 可读"的粗粒度。
- 替用户出 LLM 费用：一律 BYO key。
- 替代 Git：不做版本管理，只做归因追踪。

## Definition of Done

- 所有 `Acceptance` 项均有证据记录（日志 / 截图 / 命令输出）。
- `Test` 与 `Lint` 命令通过。
- 相关 domain spec（`minispec/specs/<domain>.md`）已随 `close` 动作更新。
- 任何跨 adapter 的事件字段变更已同步更新 `core` 包的 `Event` 类型与 schema。
- Hook 路径上的改动必须证明 p95 延迟未劣化（通过基线测试或粗略计时）。

## Generation Metadata

- source: ai-generated
- mode: updated
- context: 卡 `01-scaffold-monorepo` 应用后刷新，工程骨架已落地
- generated_at: 2026-04-27
- updated_at: 2026-04-27

## Guided Inputs

以下项在卡 `01-scaffold-monorepo` 落地时决定：

- 包管理器：**pnpm**（原生 workspace、Windows 支持好）
- 单仓结构：**monorepo `packages/*` + `packages/adapters/*`**
- 测试框架：**Vitest**
- Lint 工具：**Biome**（lint + format 一体）
- Web UI 构建：**Vite**（卡 09 具体引入）
- 发布形态：**TBD**（单二进制 / npm 包将在卡 10 `cli-serve-bundle` 阶段确定）
