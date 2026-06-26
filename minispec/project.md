# Project

`minspect` — Git blame for AI coding agents。记录 Claude Code / Codex CLI / OpenCode 等 agent 对代码库的改动，把 *session → turn → prompt → reasoning → hunk → line* 这条链回填到 UI 上，让用户看清 AI 改了什么、为什么改、改的过程。

工程骨架与首期功能已就位（见 `packages/`），后续按 minispec change card 持续迭代。当前已发布 v0.1.6。

## Stack

- Language: TypeScript 5.9.x（严格模式，`noUncheckedIndexedAccess`、`verbatimModuleSyntax`）
- Framework: Node.js monorepo，pnpm workspaces
  - 子包：`@minspect/{core, collector, cli, ui}` + `packages/adapters/{claude-code, codex, opencode, aider}`
  - UI：React 19 + Vite 7（已 shipping）
  - 状态：Fastify 5 后端，better-sqlite3 11 + WAL，tree-sitter 多语言 AST
- Runtime: Node.js 20+（`.nvmrc` 指向 20 LTS；CI 矩阵验证 20/22/24）
- Package manager: pnpm 10.x（`packageManager` 字段锁定）
- Test: Vitest 2.x（根 `vitest.config.ts` + 各包 `--passWithNoTests`），~351 tests
- Lint / Format: Biome 1.9.x（`biome.json` 根配置）
- Storage: SQLite + better-sqlite3（WAL 模式），内容寻址 blobs 表（sha256 去重）
- AST: tree-sitter（TS/JS/Python/Go/Rust/Java 6 语言）
- 目标平台：Windows / macOS / Linux（三平台均等验证）

## Commands

- Install: `pnpm install`
- Build: `pnpm -r build`
- Test: `pnpm -r test`
- Lint: `pnpm lint`
- Format: `pnpm format`
- Single-test: `pnpm -C packages/cli exec vitest run src/commands/init.test.ts`
- Bundle CLI: `node packages/cli/scripts/bundle.mjs`（发布前用）
- Release: bump `packages/cli/package.json` version → commit → `git tag vX.Y.Z` → `git push --tags`（CI 接管 npm publish + GitHub Release）

## Engineering Constraints

- **本地优先**：所有数据、索引、UI 均在用户本机运行；除 LLM Explainer（opt-in，BYO key）外，无对外网络调用。
- **Hook 必须快**：`minspect capture` / `capture-opencode` 等 hook 入口要求"快进快出"，不得阻塞 agent；异常一律 stderr + `exit 0`。
- **事件模型是跨 agent 契约**：所有 adapter 输出统一 `Event` 形状（zod schema in `@minspect/core`）；新增 agent 不应迫使核心 schema 变动。
- **内容寻址存储**：文件快照通过 `blobs` 表以 sha256 去重，避免为每次 edit 存两份全文。
- **Git 感知**：每条 edit 必须绑定 `branch` / `head` / `dirty`；commit 后通过 `commit_links` 表做事后关联。
- **LLM 调用可关**：Explainer 必须支持 BYO API key 与完全关闭开关，覆盖隐私敏感场景。
- **跨平台**：Hook 命令禁止依赖 shell 特性；以可执行二进制/绝对路径方式调用；Windows 路径转 forward slash 兼容 git-bash。
- **依赖克制**：新增依赖需有明确理由；能用 Node 标准库 + `@minspect/core` 解决的不引入第三方包。
- **平台代码隔离**：跨平台分支按 `platform()` 切分，每个 backend 单独成文件 + 单独测试，不在主流程里散落 `if (process.platform === 'darwin')`。
- **detach 共享原语**：`spawnServeDetached` / `findRunningDaemon` / `waitForDaemonReady` / `openBrowser` 是 init、hook auto-spawn、autostart 三方共用的"后台起 daemon"原语，禁止在多处重新实现。

## Non-Goals

- 团队 / 多人协作、权限模型、云端同步（MVP 不做；后续独立 change）。
- 托管服务 / 账号体系。
- 对完全不暴露 hook 的 agent（如闭源 Cursor）做深度归因——仅接到"有 diff 可读"的粗粒度。
- 替用户出 LLM 费用：一律 BYO key。
- 替代 Git：不做版本管理，只做归因追踪。
- 机器级（system-wide）systemd unit / LaunchDaemon：需要管理员权限、和"per-user"事实冲突；本项目只做用户级 login-item 集成。

## Definition of Done

- 所有 `Acceptance` 项均有证据记录（测试输出 / 命令输出 / 截图）。
- `pnpm -r test` 与 `pnpm lint` 全绿；`pnpm -r build` 无 type 错误。
- 相关 domain spec（`minispec/specs/<domain>.md`）已随 `close` 动作更新。
- 任何跨 adapter 的事件字段变更已同步更新 `@minspect/core` 的 `Event` 类型与 zod schema。
- Hook 路径上的改动必须证明 p95 延迟未劣化（baseline < 100ms）。
- 用户态 / 系统级权限边界：所有 install 改动仅落在 `$HOME` 范围；不写 `/etc` `/Library/LaunchDaemons` `C:\Windows\System32`。

## Generation Metadata

- source: ai-generated
- mode: refreshed
- context: v0.1.6 状态刷新；新增 autostart / 平台集成领域
- generated_at: 2026-04-27
- updated_at: 2026-06-26
