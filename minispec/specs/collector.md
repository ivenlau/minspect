# Collector

`@minspect/collector` — 常驻本地 daemon，接收 adapter 发来的 `Event`，按 SQLite schema 落盘，托管 UI 查询。下游一切（blame / AST / explainer / UI）都挂在它之上。

## Public surface

- `Store(dbPath)`：SQLite 连接 + 自动 `applyMigrations`。方法 `ingest(event)` 单事务写入；`close()` 关闭。
- `createServer(store)`：返回 `FastifyInstance`；含 `POST /events`、`GET /health`。
- `startServer({store, port?, host?})`：listen 并返回 `{port, stop}`。
- `state.ts`：`getStateDir()`、`getDbPath()`、`readState()`、`writeState()`、`DaemonState` 类型。

## Endpoints

- `GET /health` → `{status: 'ok'}`
- `POST /events` body: `Event`（core 的 zod schema）
  - 200 `{ok: true}`
  - 400 `{error: 'validation_error', issues: [...]}` — zod issues with field paths
  - 500 `{error: 'ingest_failed', message: '...'}` — store 抛错（例如 tool_call 引用未知 session_id）
- `POST /commit-links` body: `{commit_sha, workspace, changed_files, time_window_ms?, confidence?}`
  - 200 `{linked: N, edit_ids: [...]}`
  - 400 `{error: 'invalid_payload'}`
  - 匹配规则：`edits.workspace_id == workspace` AND `created_at >= now - time_window_ms (default 24h)` AND `file_path IN changed_files` AND 不在本 commit 已有 links 中（自幂等）。
- `POST /commit-links` body: `{commit_sha, workspace, changed_files[], time_window_ms?, confidence?}`
  - 200 `{linked: n, edit_ids: string[]}`
  - 400 `{error: 'invalid_payload'}`
  - 500 `{error: 'link_failed', message}`
  - 路径匹配在 workspace_id / file_path 上做分隔符归一化（`REPLACE(path, '\', '/')`），桥接 Claude Code hook 的 OS-native 路径（Windows 反斜杠）和 git 返回的 forward-slash relative 路径。
- `GET /api/blobs/:hash` → 200 `text/plain` body = blob content；`ETag: <hash>`
  - 400 `{error: 'invalid_hash'}` — hash 不是 64 位 hex
  - 404 `{error: 'not_found'}`
- `GET /api/revert/plan?turn=<id>` 或 `?edit=<id>`（二选一）→ 200 `{target_kind, target_id, source_agent, files: [{file_path, workspace_id, before_hash, after_hash, expected_current_hash, kind: 'restore' | 'delete'}], warnings: {codex_source, chain_broken_user_edits, later_edits_will_be_lost}}`
  - 400 `{error: 'specify_turn_or_edit'}` — 缺 / 都传
  - 404 `{error: 'not_found'}`
  - 用途：`minspect revert` CLI + UI revert 按钮 modal 的数据源。Server **只读**（不执行写回），写磁盘由 CLI 完成。

## Canonical rules

- **事务边界 = 一个事件**：`Store.ingest(event)` 内部开事务，所有表写入（含 blobs、hunks、edits）要么全成要么全回滚。
- **workspace_id = workspace path**：不引入 UUID 层；path 已唯一且稳定。`workspaces.id TEXT` 存的就是路径。
- **事件幂等**：所有 INSERT 走 `ON CONFLICT(id) DO NOTHING`；blobs 走 `INSERT OR IGNORE`（内容寻址）。磁盘队列重放安全。
- **ID 生成规则**（确定性、可重算）：
  - `edit_id = ${tool_call_id}:${idx}`（idx = file_edit 在 tool_call 内的顺序，0-based）
  - `hunk_id = ${edit_id}:${hunkIdx}`（MVP 仅 `:0`）
- **hunks 写入策略**：`updateBlameForEdit`（blame.ts）统一管理。对新文件单一 whole-file hunk（`old_start=null`）；对修改走 `diff.structuredPatch(context: 0)`，每个 `structuredPatch.hunks[i]` 映射一行 `hunks` 表。hunk id = `${edit_id}:${i}`。
- **line_blame 传播**：`propagateBlame({prior_blame, before_lines, after_lines, ...})` 纯函数。对未改动行按 `line_no` 继承 prior 的 `edit_id`/`turn_id`；对插入行归属当前 edit；对删除行跳过。
- **Chain 断裂**：prior edit 的 `after_hash` !== 本次 edit 的 `before_hash` 时，视为用户在两次 edit 之间手改了文件，不继承 prior blame，把所有新行归当前 edit。（原设计的 `invalidated` 列未加，用这种方式表达更干净。）
- **SQLite 配置**：`journal_mode=WAL`；不启用外键（schema 无 FK 约束）。
- **状态文件**：`DaemonState { port, pid, started_at }`，JSON 格式，`platform()==='win32'` 时走 `%LOCALAPPDATA%\minspect`，否则 `$XDG_STATE_HOME/minspect`（默认 `~/.local/state/minspect`）。
- **SQLite 文件**：`<state_dir>/history.sqlite`。

## Canonical commands

- Dev 启动（临时，后续卡 10 替换）：直接导入 `Store` + `startServer` 程序化启动
- 清数据：删除 `<state_dir>/` 整个目录（无外部状态）

## Changes

### 33-cross-session-search (closed 2026-04-28 — Store + /api/search part)

**Why**
⌘K palette 的后端：cross-session FTS 搜 prompt / reasoning / tool-call explanation / file path。

**Scope 落地**
- `Store.ftsEnabled` 标记 + `backfillSearchIndex()`（老 DB 启动时 replay turns / tool_calls.explanation / edits 到 FTS，空库 no-op）
- 每个 ingest handler 尾巴 `ftsInsert(kind, source_id, session_id, workspace_id, content)`：
  - `onTurnStart` → prompt（source_id = turn_id）
  - `onTurnEnd` → reasoning + message（仅首次 COALESCE 实际落盘才写，防重复）
  - `onToolCallExplanation` → explanation（仅匹配且 UPDATE 有效时写）
  - `writeFileEdit` → file_path（source_id = edit_id）
- `/api/search?q=&limit=`：lowercase + 非 `\w./ ` 标点 strip + 丢停用词（AND/OR/NOT/NEAR/the/a/an）+ token 加 `*` prefix；bm25 排序 + `snippet(..., '<mark>', ..., '…', 10)` 高亮；FTS 不可用 → `{fts_available: false, results: []}`；malformed MATCH → try/catch 返回空
- 测试：store 3 新 case（写 5 kinds、backfill、turn_end 幂等），api 3 新 case（正常、空 q、punctuation/AND sanitize）

**Out / Risks**
- LIKE fallback：拒绝，UI 直接提示 "FTS5 not available"
- ingest 写入性能：FTS insert 和 line_blame 同数量级，都在 `Store.ingest` 的同一 transaction 里
- snippet 里的 `<mark>` 通过 `dangerouslySetInnerHTML` 渲染：localhost-only 服务，snippet 来源是 collector 自身输出

> 完整记录：`minispec/archive/33-cross-session-search.md`.

### 08-indexer-ast (closed 2026-04-27)

**Why**
UI 按方法/类聚合需要 AST 信息。

**Scope 实际落地（调整）**
- 原计划 tree-sitter + 6 语言；**MVP 实际：regex 覆盖 JS/TS**（`.ts|.tsx|.js|.jsx|.mjs|.cjs`）；其它语言回退 `kind='file'` 整文件节点。
- 理由：tree-sitter 跨平台原生构建风险高；本项目即 TS，UI 只需 JS/TS 有真 method 级别。
- 回滚路径：`extractAstNodes` 是接口单一点；未来替换成 tree-sitter 无下游改动。

**Scope / Acceptance**
- `extractAstNodes(filePath, content)` 抽 top-level function / arrow-const function / class / class-内 method，带 qualified_name（`Class.method`）。
- `updateAstForEdit(store, args)`：按 edit hunks 的 `new_start`/`new_count` 与 ast_node 的 `start_line`/`end_line` 求相交，写 `edit_ast_impact`。
- 7 新测；88/88 全绿。

> 详见 `minispec/archive/08-indexer-ast.md`.

### 07-indexer-line-blame (closed 2026-04-27)

**Why**
"AI Blame" 差异化功能。没有行血缘，UI 只能到文件级。

**Scope**
- In: `blame.ts`（`computeHunks` + `propagateBlame` + `updateBlameForEdit`）；Store 对接；依赖 `diff ^7`；11 新测。
- Out: 重命名/移动检测；跨分支合并；正式 fuzz/benchmark。

**Scope 微调**
- 不加 `line_blame.invalidated` 列。断链通过 `prior.after_hash !== before_hash` 判定，触发"全部归当前 edit"。UI 可以通过比较 edit 之间的 hash 过渡来展示用户修改。

**Acceptance 映射**
- 插入 5-7 行 / 删除 5-7 行 / 用户手改 chain 断 → 对应 4 个单测。
- fuzz 100 轮 / 10k × 100 benchmark → 替换为 5 个确定性单测 + 观察性能（单次 ~1ms，远低于要求）。

> 完整记录见 `minispec/archive/07-indexer-line-blame.md`.

### 06-git-commit-link (closed 2026-04-27)

在 collector 侧贡献 `POST /commit-links` + `linkCommit(store, req)`；按 `workspace_id + file_path IN (...) + created_at >= (now - window)` 匹配 edits，`INSERT OR IGNORE` 去重。Schema 加 `commit_links.confidence REAL NOT NULL DEFAULT 1.0`。migration 的 `applyMigrations` 追加幂等 ALTER TABLE 兜底升级。完整卡信息见 `specs/cli.md` 与 `archive/06-git-commit-link.md`。

### 03-collector-foundation (closed 2026-04-27)

**Why**
Hook 发的事件要有地方落。UI 查的数据要有地方读。没它，后续所有活的卡都动不了。

**Scope**
- In: `state.ts`（状态目录 + state.json + db 路径）；`store.ts`（SQLite + Store 类 + 事件 dispatch + 事务 + blob 去重 + 整文件 hunk）；`server.ts`（Fastify `/events` + `/health`）；核心 Event 命名类型在 core 补导出。
- Out: line blame（卡 07）；AST 索引（卡 08）；LLM Explainer（卡 12）；UI 静态托管（卡 09）。

**Acceptance（全部通过）**
- 合法 Event POST → 200 且落盘；非法 → 400 带 zod issue 路径。
- 100 并发 POST 全部入库、无丢失（`server.test.ts`）。
- 状态文件首次启动生成；`readState` 对缺失 / 损坏文件返回 null。
- 幂等：同 id session / tool_call 重复 ingest 不插多行。
- blobs 按 sha256 hash 去重。
- tool_call 引用未知 session → 抛错，事务回滚。

**Notes**
- 新增依赖：`@minspect/collector` → `@minspect/core` / `better-sqlite3 ^11.8` / `fastify ^5`；dev `@types/better-sqlite3`。根 `pnpm.onlyBuiltDependencies` 追加 `better-sqlite3`。
- better-sqlite3 11.10.0 在 Node 24 + Windows MSVC 下从源码编译成功（约 1 分钟），无额外工具链需求。
- 为避免下游包反推 zod infer，core 补了 `SessionStartEvent` 等命名 type 导出。

> 完整 Plan 与 Risks and Rollback：见 `minispec/archive/03-collector-foundation.md`.
