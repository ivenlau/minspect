# Core

`@minspect/core` — 跨 adapter / collector / cli / ui 的契约地基：`Event` 事件模型、SQLite schema、git 状态读取。零运行时副作用，零 SQLite 原生依赖。

## Public surface

从 `@minspect/core` 导出：

- **Event schemas（zod + inferred TS）**
  - `EventSchema`：`session_start | turn_start | tool_call | turn_end | session_end` 的 discriminated union
  - 各子 schema：`SessionStartEventSchema` 等
  - `GitStateSchema`、`FileEditSchema`、`ToolCallStatusSchema`
- **DB 实体 schema**
  - `WorkspaceSchema`、`SessionSchema`、`TurnSchema`、`ToolCallSchema`、`EditSchema`、`HunkSchema`、`LineBlameSchema`、`AstNodeSchema`
  - 对应 inferred type：`Workspace`、`Session` 等
- **Migrations**
  - `INITIAL_SCHEMA_SQL: string` — 首版完整 SQLite schema（所有 CREATE 都带 `IF NOT EXISTS`，支持幂等）
  - `SqlExec` 接口：`{ exec(sql: string): void }`（`better-sqlite3` 与 `node:sqlite` 均满足）
  - `applyMigrations(db: SqlExec): void`
  - `SqlProbe` 接口 + `hasSearchIndex(db): boolean` — 探测 FTS5 `search_index` 虚拟表是否存在（FTS5 在 `applyMigrations` 末尾 try/catch 创建；SQLite 未编译 FTS5 时 `hasSearchIndex` 返回 false 供调用方降级）
- **Git helpers**
  - `readGitState(cwd: string): GitState | null`
    - 非 git 目录返回 `null`（不抛）
    - 空 repo 无 commit 时 `head: ''`
    - 通过 `git status --porcelain` 空/非空判断 `dirty`

## Canonical rules

- **Event 类型变更必须改 zod schema**：adapter 边界是外部输入，运行时校验不可省。
- **SQL 单一来源**：`INITIAL_SCHEMA_SQL`（TS 字符串）是运行时源，`schema.sql`（人类可读副本）仅文档用途；`migrations.test.ts` 的"byte-for-byte equality"断言防漂移，两者必须同步修改。
- **迁移幂等**：所有未来 migration 的 DDL 必须允许重复执行（使用 `IF NOT EXISTS` 或前置存在性检查）。
- **core 不带 SQLite 运行时**：`applyMigrations` 通过注入接口拿 db；`better-sqlite3` / `node:sqlite` 安装在 collector 或测试里。
- **`GitState` 类型仅在 `types.ts` 定义**，`git.ts` 用 `import type` 复用；禁止双处导出。

## Known workarounds

- **Vite 5 + `node:sqlite`**：Vite 5 的 Node 内置白名单未收录 `node:sqlite`（Node 22.5+），静态分析会剥掉 `node:` 前缀把 `sqlite` 当普通包解析失败。`vitest.config.ts` 的 `server.deps.external` 无效。解法：在使用 `node:sqlite` 的测试文件里用 `createRequire(import.meta.url)` 运行时 require。Vitest 升到 3.x 后可复查是否能移除。

## Changes

### 33-cross-session-search (closed 2026-04-28 — FTS5 migration part)

**Why**
给 ⌘K palette 一个真实的后端。跨 session 搜 prompt / reasoning / tool-call explanation / file path 原来一直是 `alert('coming soon')`。

**Scope 落地**
- `applyMigrations` 末尾 try/catch 创建 `search_index` FTS5 虚拟表（columns: kind, source_id UNINDEXED, session_id UNINDEXED, workspace_id UNINDEXED, content；tokenize = porter unicode61 remove_diacritics 1）
- 新 `SqlProbe` 接口 + `hasSearchIndex(db)` helper
- INITIAL_SCHEMA_SQL 不变（FTS5 在 upgrade 分支，不破坏 byte-equal drift 测）
- `migrations.test.ts` +2 case：FTS5 存在性 + MATCH 返回 bm25-sorted 命中

**Out**
- LIKE 降级（保持代码简单）
- FTS 列结构变更 / trigger 模式（手动在 Store 的 ingest handler 里写入，简化到透明）

> 完整记录：`minispec/archive/33-cross-session-search.md`.

### 02-core-types-schema (closed 2026-04-27)

**Why**
`core` 是所有下游包的类型与 schema 源头；没它，adapter / collector / ui 都在猜类型。

**Scope**
- In: `types.ts`（Event 联合 + 各实体 zod schema）；`schema.sql`（§4 全量表与索引）；`migrations.ts`（含 `INITIAL_SCHEMA_SQL` 字符串、`SqlExec` 接口、`applyMigrations`）；`git.ts`（`readGitState`）；三个单测文件共 14 用例。
- Out: 实际 DB 连接；sqlite-vec；事件级业务校验（如 turn_idx 单调性）。

**Acceptance（全部通过）**
- Event zod 合法解析返回 typed；非法带字段路径抛错。
- `INITIAL_SCHEMA_SQL` 应用到全新 SQLite 后 11 表 + 3 索引齐全，且可幂等二次应用。
- `readGitState` 在 repo / fresh repo / clean / dirty / 非 repo 五态正确。

**Notes**
- 新增依赖：`@minspect/core` → `zod ^3.23.8`；根 devDep → `@types/node ^22.10.0`。
- SQL 以 TS 模板字符串嵌入而非 `fs.readFileSync(schema.sql)`：dist 零资源拷贝、import 零 I/O。drift 风险用 byte-equal 测试封堵。
- Node 24 的 `node:sqlite` 会带 `ExperimentalWarning`，不影响通过。

> 完整 Plan 与 Risks and Rollback：见 `minispec/archive/02-core-types-schema.md`.
