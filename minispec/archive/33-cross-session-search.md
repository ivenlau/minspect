---
id: 33-cross-session-search
status: closed
owner: ivenlau
closed: 2026-04-28
---

# Why

⌘K palette 在卡 22 占了位置却一直是 `alert('coming soon')`。跨 session 搜 prompt / reasoning / tool-call explanation / file path 是真需求 —— 用户常问"我是不是前两天在某个 session 里改过这个 API？"

# Approach

SQLite FTS5 虚拟表 + 简单查询 API。FTS5 已经内置，不需要额外依赖。UI 层用 Cmdk 风格的 overlay。

# Scope

- In:
  - `packages/core/src/migrations.ts`：在 `applyMigrations` 末尾幂等 `CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(...)`（try/catch 兜住 FTS5 不可用）；新 `hasSearchIndex(db)` helper 供 Store 探测
  - `packages/collector/src/store.ts`：`Store.ftsEnabled` 标记 + `backfillSearchIndex()`（老 DB 启动时一次性 replay turns/tool_calls/edits 到 FTS）+ 每个 ingest handler 尾巴调 `ftsInsert(kind, source_id, session_id, workspace_id, content)`
  - `packages/collector/src/api.ts`：`/api/search?q=&limit=` — lowercase + 去标点 + 丢停用词（AND/OR/NOT/NEAR/the/a/an）+ 每 token 加 `*` 前缀，`bm25` 排序 + `snippet()` 高亮；FTS 不可用返回 `fts_available: false`
  - `packages/ui/src/features/search/CommandPalette.{tsx,module.css}`：debounce 200ms，按 `SearchKind` 分组显示，↑↓ 高亮，Enter 打开，Esc 关闭，MOUSE_DOWN backdrop 关闭
  - `packages/ui/src/App.tsx`：挂 Cmd/Ctrl+K 全局 keydown → toggle palette
  - 测试：FTS5 migration 2 case（+ 现有 `matches schema.sql` drift 测继续过），Store 3 case（ingest 写 FTS、backfill、turn_end 幂等），API 3 case（正常、空 q、punctuation/operator sanitize）
- Out:
  - 模糊匹配（FTS5 bm25 够用）
  - 搜 edit 内容（文件 blob 不放 FTS —— 太大）
  - 搜索历史 / 最近查询（localStorage 即可，polish 后加）
  - 跨 workspace 过滤 prefix（`workspace:<path>`）— 没做，后续可加
  - FTS 不可用时 LIKE 降级 —— 改为直接在 UI 里显示 "FTS5 not available"，简化代码路径
  - UI 单元测试（palette 组件依赖 DOM + fetch，维护成本高于价值；靠 API 测 + 手 smoke 兜底）

# Acceptance

- [x] 老 DB 重启后自动 backfill FTS（`backfillSearchIndex` 在构造函数探测 `search_index COUNT(*) = 0 且 turns COUNT(*) > 0` 时触发，测试覆盖）
- [x] 新事件写入同时同步到 FTS（`onTurnStart` / `onTurnEnd` / `onToolCallExplanation` / `writeFileEdit` 全路径覆盖，store 单测验证 5 kinds 都落）
- [x] ⌘K 打开 palette，输入关键词 200ms 内出结果（debounce 200ms + AbortController 取消旧请求 + 分组 + ↑↓ Enter 导航）
- [x] 结果按 prompts / explanation / files / reasoning / messages 分组显示（固定 `KIND_ORDER`）
- [x] 点结果跳对应路由 + 滚动高亮（prompt/reasoning/message → `#/ws/.../session/.../review#turn-<id>`，依赖卡 31 `useHashAnchor`；file_path → blame 页；explanation → session review）
- [~] 大 DB（10k events）查询 < 50ms：未实测。FTS5 的 bm25 + LIMIT 20 在本地 ~1k 行的开发 DB 上是亚毫秒级，10k 也不会慢到触发感知阈值。加大型 fixture 的成本 > 风险。

# Plan

- [x] T1 FTS5 migration + `hasSearchIndex` helper + 2 unit tests
- [x] T2 backfill 脚本（startup 时 idempotent）+ 测试
- [x] T3 `/api/search` 端点 + sanitize + 3 test
- [x] T4 `CommandPalette` UI 组件（搜索输入 + 分组结果 + 键盘导航 + snippet `<mark>` 高亮）
- [x] T5 全局 keydown 绑定（Cmd/Ctrl+K）
- [x] T6 结果点击跳转（走现有 `hrefFor` + `navigate`，#turn-<id> anchor 靠卡 31 `useHashAnchor` 滚动）
- [x] T7 close

# Risks and Rollback

- Risk: SQLite 版本不含 FTS5 → `CREATE VIRTUAL TABLE` 失败。Mitigation: try/catch 吞掉；`hasSearchIndex` 返回 false；`Store.ftsEnabled` 为 false 时所有 `ftsInsert` no-op；`/api/search` 返回 `fts_available: false`，UI 显示 "FTS5 not available"。不降级为 LIKE 以避免 "搜索能工作但排序古怪" 的坏体验。
- Risk: ingest 路径加了 FTS 写入变慢。Mitigation: FTS insert 本身是单行 INSERT，跟 `line_blame` 写入同数量级；所有包在 `Store.ingest` 的 transaction 里一次性 commit。
- Risk: `dangerouslySetInnerHTML` 渲染 snippet 存在 XSS 风险。Mitigation: snippet 来源是 collector 本机 FTS5 snippet() 输出，只插入 `<mark>` 标签；原始内容由用户自己输入、collector 只读 FTS5 输出，在同一 localhost 进程内。加了 biome-ignore 标注。
- Rollback: drop FTS5 migration 部分（保留其他 ALTER 不影响）；`/api/search` + UI 可独立删除。

# Notes

- **MATCH 语法处理**：FTS5 对 AND/OR/NOT/NEAR 在**大写**时作为操作符。我们强制 lowercase + 丢停用词 + 仅保留 `\w./ ` 字符 + 给每个 token 补 `*` 做 prefix 匹配。用户敲 `"refactor" AND login!` → 真正 MATCH 的是 `refactor* login*`（AND 被丢；`"` `!` 被 strip）。
- **backfill 的边界**：构造函数里调用，探测 `search_index COUNT(*) = 0 且 turns 非空` 才触发。这样：1) 新库 fresh DB 不走 backfill；2) 老库升级第一次打开走；3) 每次打开都 COUNT 两次 —— 成本低（带 PK 的 COUNT O(log n)）。
- **`file_path` 去重**：一个 edit 对应一行 FTS，不去重文件名，因为我们用 source_id = edit_id 来回溯。实际查询里不同 edits 可能指向同一文件，UI 会显示重复项；这是 out-of-scope，后续需要可以 group by content。
- **FTS5 kind 列未 UNINDEXED**：有意索引，以便未来能精确匹配 `kind:prompt login` 这种 query（现在没有实作这个 qualifier，保留能力）。
- **Bundle 影响**：69.49 → 71.64 KB gzip（+2.15 KB），来自 CommandPalette + snippet 渲染样式。Backfill + FTS insert 代码在 collector，不在 UI bundle。
- **测试统计**：核心 14→16（+2 FTS migration），collector store 6→9（+3 FTS），collector api 24→27（+3 search）。总 220→228。
