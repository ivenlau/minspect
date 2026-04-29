---
id: 01-scaffold-monorepo
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: foundation
---

# Why

仓库当前只有设计文档、没有可执行代码。后续所有卡片都需要一个 TypeScript monorepo 作为落地容器；先把空骨架、包划分、lint/test 工具链搭好，让后续每张卡都能"新增文件即可"。

# Approach

- Considered:
  - pnpm workspaces：安装快、原生 workspace、Windows 支持好。
  - npm workspaces：标准库但慢、依赖提升策略不如 pnpm 干净。
  - Turbo / Nx：构建图强大但对 MVP 是过度设计。
- Chosen: pnpm workspaces。决定性 trade-off：单人 MVP 阶段更看重开发体验和安装速度，不需要 Turbo/Nx 的增量构建。

# Scope

- In:
  - 根 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.nvmrc`（Node 20 LTS）。
  - 子包骨架：`packages/{core,collector,cli,adapters/claude-code,ui}`，每个含空 `package.json` + `src/index.ts` 占位。
  - Biome（lint + format）根配置。
  - Vitest 根配置。
  - `.gitignore` 补 `dist/`、`node_modules/`、`.minspect/`、`*.sqlite`。
- Out:
  - 任何业务代码（走后续卡）。
  - CI / GitHub Actions。
  - 发布工作流。

# Acceptance

- [x] Given 一次干净 clone When 执行 `pnpm install` Then 所有 workspace 包解析成功、无报错
- [x] Given 仓库 When 执行 `pnpm -r build` Then 所有包 TS 编译通过（空实现可）
- [x] Given 仓库 When 执行 `pnpm -r test` Then Vitest 启动成功（零测试 ok）
- [x] Given 仓库 When 执行 `pnpm lint` Then Biome 检查通过

# Plan

- [x] T1 根配置文件：`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.nvmrc`、`biome.json`、`vitest.config.ts`、`.gitignore`
  - Expected output: `pnpm install` 通过
- [x] T2 子包骨架 `packages/core` / `collector` / `cli` / `adapters/claude-code` / `ui`，各含 `package.json` + `src/index.ts`
  - Expected output: `pnpm -r build` 通过
- [x] T3 回写 `minispec/project.md` 的 `## Stack` 与 `## Commands` 段（auto-managed 部分刷新）
  - Expected output: project.md 中不再有 TBD

# Risks and Rollback

- Risk: Biome 规则与个人习惯不合后续要换 ESLint，迁移成本中等
- Rollback: 单卡 revert 即可，无外部依赖

# Notes

- Node 20 LTS；所有包 `"private": true`
- UI 包后续会引入 Vite + React，这张卡只放空骨架，不装 React

## Execution notes (2026-04-27)

- 实际 Node 24.11.1 + pnpm 10.32.1；`.nvmrc=20`、`engines.node=">=20"` 兼容。
- pnpm 10 默认 block `@biomejs/biome` 与 `esbuild` 的 postinstall；解法：`package.json` 加 `pnpm.onlyBuiltDependencies: ["@biomejs/biome", "esbuild"]`。若后续新增需要 postinstall 的依赖（如 `better-sqlite3` / `tree-sitter`），要在对应卡片里同步追加。
- Biome 首次 `lint` 因自身 `biome.json` 未格式化而报错；`pnpm format` 一次即绿。已加入工作流：新增根配置文件后跑一次 `pnpm format`。
- 验收证据：
  - `pnpm install` → 6 workspace projects resolved
  - `pnpm -r build` → 5 TS 包全部编译通过
  - `pnpm -r test` → 5 包 Vitest 全部 "No test files found, exiting with code 0"
  - `pnpm lint` → `Checked 20 files in 14ms. No fixes applied.`
- Vitest 跑出 "CJS build of Vite's Node API is deprecated" 警告；不影响通过，后续可替换为 Vite ESM 或升 Vitest 3.x 时消除。

## Check (2026-04-27)

独立重跑 `project.md` 定义的全部命令，输出与 apply 时一致：

| 项 | 命令 | 结果 |
|---|---|---|
| A1 install | `pnpm install --frozen-lockfile` | `Lockfile is up to date` / `Done in 710ms` |
| A2 build | `pnpm -r build` | 5 包全绿（core / collector / cli / adapter-claude-code / ui） |
| A3 test | `pnpm -r test` | 5 包 "No test files found, exiting with code 0" |
| A4 lint | `pnpm lint` | `Checked 20 files in 12ms. No fixes applied.` |

无 FAIL 项。本卡满足 Definition of Done 中 Acceptance / Test / Lint 条目；可进入 `close`。

## Close (2026-04-27)

- Spec 落位：`minispec/specs/foundation.md`（新建首个 domain）。
- README 索引：`minispec/specs/README.md` 已登记 `foundation.md`。
- 卡状态 `in_progress` → `closed`，文件自 `changes/` 归档至 `archive/`。
