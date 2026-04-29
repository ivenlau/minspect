# Foundation

跨领域工程骨架：monorepo 结构、包划分、TypeScript / 构建 / 测试 / lint 工具链、`.gitignore` 与平台约束。后续所有业务包（`core` / `collector` / `cli` / `ui` / `adapters/*`）都栖息于此之上。

## Canonical rules

- 包管理器：**pnpm** 10.x，根 `packageManager` 字段锁定。
- 目录结构：`packages/*` 为普通子包；`packages/adapters/*` 为 agent 适配器子包。`pnpm-workspace.yaml` 同时列出两组。
- 当前子包集合（通过 `@minspect/*` 作用域标识）：`core` / `collector` / `cli` / `ui` / `adapter-claude-code`。新增子包需在对应 change 内加入 workspace 匹配。
- TypeScript：根 `tsconfig.base.json`，严格模式 + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`；每个子包 `tsconfig.json` 仅覆写 `outDir` / `rootDir` / `include`。
- 运行时：Node 20+（`.nvmrc=20`，`engines.node>=20`），已验证 Node 24 兼容运行。
- 测试：Vitest 2.x；每包 `test` 脚本默认 `vitest run --passWithNoTests`，根 `vitest.config.ts` 统一 `include: src/**/*.{test,spec}.ts`。
- Lint / Format：Biome 1.9.x 一体化。**`pnpm format` 只修 formatter 违规，不处理 `organizeImports`**；新写 TS 文件后应跑 `pnpm exec biome check --write .` 一次性修 format + import order，再跑 `pnpm lint` 验证。新增根配置文件后同样走这条路径。
- 产物：`dist/` 为每包构建输出，根 `.gitignore` 已排除。
- 运行时本地数据：`.minspect/`、`*.sqlite*`，根 `.gitignore` 已排除。
- pnpm 10 postinstall 白名单：`package.json.pnpm.onlyBuiltDependencies` 目前含 `@biomejs/biome`、`esbuild`。后续引入需 postinstall 的依赖（如 `better-sqlite3` / `tree-sitter`）时，必须在对应 change 中追加，不然运行时行为异常。

## Commands

- Install: `pnpm install`
- Build: `pnpm -r build`
- Test: `pnpm -r test`
- Lint: `pnpm lint`
- Format: `pnpm format`

## Changes

### 01-scaffold-monorepo (closed 2026-04-27)

**Why**
仓库此前只有设计文档、没有可执行代码。后续所有卡片都需要一个 TypeScript monorepo 作为落地容器；先把空骨架、包划分、lint/test 工具链搭好，让后续每张卡都能"新增文件即可"。

**Scope**
- In: 根 `package.json` / `pnpm-workspace.yaml` / `tsconfig.base.json` / `.nvmrc` / `biome.json` / `vitest.config.ts`；子包骨架 `packages/{core,collector,cli,adapters/claude-code,ui}` 各含 `package.json` + `tsconfig.json` + `src/index.ts` 占位；`.gitignore` 扩充。
- Out: 业务代码；CI / GitHub Actions；发布工作流。

**Acceptance（全部通过）**
- `pnpm install` 所有 workspace 包解析成功、无报错。
- `pnpm -r build` 所有包 TS 编译通过。
- `pnpm -r test` Vitest 启动成功（零测试 ok）。
- `pnpm lint` Biome 检查通过。

**Notes**
- Node 20 LTS；所有子包 `"private": true`。
- UI 包此卡只放空骨架，Vite + React 留给卡 09。
- pnpm 10 默认屏蔽 `@biomejs/biome` / `esbuild` 的 postinstall；已通过 `pnpm.onlyBuiltDependencies` 白名单解除。
- Biome 首次 lint 对自身 `biome.json` 报格式；约定新根配置落地后先 `pnpm format`。
- Vitest 跑出 "CJS build of Vite's Node API is deprecated" 警告；不影响通过，升级 Vitest 3.x 时消除。

> 完整 Plan 与 Risks and Rollback：见 `minispec/archive/01-scaffold-monorepo.md`.
