---
id: 02-core-types-schema
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: core
---

# Why

`core` 包是跨 adapter、collector、ui 的契约地基：所有 adapter 输出 `Event`、collector 按 schema 落盘、ui 按类型查询。没有 core 定下来，后续所有卡都在猜类型。

# Approach

- 单一合理路径：zod 定义 `Event` discriminated union + 独立 `schema.sql` 文件；`child_process` 执行 `git` 读取状态。
- 为什么选 zod：adapter 边界需要运行时校验（hook payload 是外部输入），zod 同时能 infer 出 TS 类型，避免手写类型守卫。

# Scope

- In:
  - `packages/core/src/types.ts`：`Event` 联合类型（session_start / turn_start / tool_call / turn_end / session_end）、`Session` / `Turn` / `ToolCall` / `Edit` / `Hunk` / `GitState` 类型，全部 zod schema。
  - `packages/core/src/schema.sql`：设计文档 §4 列的全部表与索引。
  - `packages/core/src/migrations.ts`：`applyMigrations(db)`，首次启动执行 schema.sql。
  - `packages/core/src/git.ts`：`readGitState(cwd): {branch, head, dirty}`。
  - 单元测试覆盖 zod round-trip、schema 应用、git 状态读取。
- Out:
  - 实际 DB 连接（交给 collector）。
  - sqlite-vec（Phase 2+）。
  - 事件级别的业务校验（比如 turn_idx 单调）——留给 collector。

# Acceptance

- [x] Given 合法的 `Event` payload When 用导出的 zod schema 解析 Then 返回 typed 对象
- [x] Given 非法 payload（缺字段 / 类型错） When 解析 Then 抛错且定位到字段
- [x] Given `schema.sql` When 应用到全新 SQLite 文件 Then 所有表与索引创建成功
- [x] Given 一个 git 工作区 When 调用 `readGitState(cwd)` Then 返回正确的 `{branch, head, dirty}`
- [x] Given 非 git 目录 When 调用 Then 返回 `null` 而非抛错

# Plan

- [x] T1 `types.ts`：`Event` 联合类型 + 各实体 zod schema
  - Expected output: `core` 包 build 通过、测试用例覆盖 5 种 Event
- [x] T2 `schema.sql` 按设计文档 §4 全量列表
  - Expected output: 单元测试 "schema applies cleanly" 通过
- [x] T3 `migrations.ts` + `applyMigrations(db)`
  - Expected output: 幂等（重复执行不报错）
- [x] T4 `git.ts` + `readGitState`
  - Expected output: 测试覆盖 repo / 非 repo / dirty 三种情况

# Risks and Rollback

- Risk: schema 日后演进需要迁移。Mitigation: 从第一版起就用 numbered migration 文件，不用单一 `schema.sql` 合并
- Rollback: revert 包

# Notes

- `better-sqlite3` 的依赖安装放到 collector 卡，core 只给出 SQL 文本和 migration 执行器接口（传入 db 对象）

## Execution notes (2026-04-27)

**依赖新增**
- `@minspect/core` → `zod ^3.23.8`（runtime 依赖）
- 根 devDep → `@types/node ^22.10.0`

**设计决定**
- `migrations.ts` 的 `INITIAL_SCHEMA_SQL` 直接以模板字符串嵌入 TS（非 `fs.readFileSync(schema.sql)`），目的：dist 输出零资源拷贝、import 时零 I/O。`schema.sql` 作为"人类可读参考副本"保留，加 `migrations.test.ts > matches schema.sql byte-for-byte` 防漂移。
- `applyMigrations(db: SqlExec)` 用最小接口 `{exec(sql): void}`，`better-sqlite3` 与 `node:sqlite` 都满足，core 无需任何 SQLite 运行时。
- `GitState` 类型只在 `types.ts` 定义，`git.ts` 用 `import type { GitState }` 复用；避免双处导出冲突。

**过程中的坑（解法已落）**
- **坑 1**：Vite 5 内置 Node modules 白名单不含 `node:sqlite`（Node 22.5+ 新加），静态分析剥掉 `node:` 前缀后试图把 `sqlite` 当普通包解析。`vitest.config.ts` 加 `server.deps.external: ['node:sqlite']` 无效。解法：在 `migrations.test.ts` 改用 `createRequire(import.meta.url)` 运行时 require，彻底绕开 Vite 静态分析。待 Vitest 升到 3.x 后可回退。
- **坑 2**：Biome `lint` 对 `organizeImports` 不 autofix；`pnpm format` 只修 formatter 问题，不处理 import order。工作流修正：新写 TS 文件之后跑 `pnpm exec biome check --write .`，不是 `pnpm format`。已收敛为一次性解法。
- Node 24 跑 `node:sqlite` 会带 "experimental" 警告，不阻塞；升 Node 后消除。

**Foundation spec 增量（需同步）**
- 新 TS 文件的定型流程：写完 → `pnpm exec biome check --write .` → 再跑 `pnpm lint`。这比 foundation.md 里当前记录的 "`pnpm format`" 严格一档，下次碰 foundation spec 时补一笔。
- Close 时已同步到 `specs/foundation.md` 的 `Canonical rules > Lint / Format` 条目。

**验收证据**
- `pnpm --filter @minspect/core test` → 14/14 通过（types 7、migrations 3、git 4）
- `pnpm -r build` → 全绿
- `pnpm lint` → `Checked 26 files in 26ms. No fixes applied.`

## Check (2026-04-27)

独立重跑 `project.md` 定义的全部命令：

| 项 | 命令 | 结果 |
|---|---|---|
| A1 install | `pnpm install --frozen-lockfile` | `Already up to date` / `Done in 765ms` |
| A2 build | `pnpm -r build` | 5 包全绿（core / collector / cli / adapter-claude-code / ui） |
| A3 test | `pnpm -r test` | core 14/14 通过；其余 4 包 `No test files found, exiting with code 0` |
| A4 lint | `pnpm lint` | `Checked 26 files in 33ms. No fixes applied.` |

具体验收映射（全部证据源自 `pnpm --filter @minspect/core test` 输出）：

| Acceptance | 证据 |
|---|---|
| Event zod 合法解析 | `types.test.ts` 的 4 个 parse 用例通过 |
| Event zod 非法带路径 | `types.test.ts` 3 个 reject 用例通过，错误路径含 `type` / `session_id` / `timestamp` |
| schema.sql 应用成功 | `migrations.test.ts > creates every expected table and index` 通过 |
| `readGitState` 三态正确 | `git.test.ts` 4 用例通过（非 repo → null；fresh repo；clean；dirty） |
| 非 git 目录返回 null | `git.test.ts > returns null for a non-git directory` 通过 |

无 FAIL 项。卡可进入 `close`。

## Close (2026-04-27)

- 新建 `minispec/specs/core.md`（首个 core domain），抽取 Public surface / Canonical rules / Known workarounds。
- 同步更新 `minispec/specs/foundation.md` 的 Lint/Format 条目，明确 `pnpm exec biome check --write .` 才能同时修 format + import order。
- `minispec/specs/README.md` domain 索引登记 `core.md`。
- 卡状态 `in_progress` → `closed`，文件自 `changes/` 归档至 `archive/`。
