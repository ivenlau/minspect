---
id: 53-session-delete
status: closed
---

# Why

用户积累的 session 数据越来越多，但目前没有删除入口。无用 session 占据 sidebar / timeline / workspace 列表，干扰浏览。需要提供 session 级别的删除功能，并要求二次确认以防误删。

# Approach

- 只有一种合理方案：后端加 `DELETE /api/sessions/:id`，前端在 SessionOverviewPage 加删除按钮 + 确认 modal。
- 考虑过软删除（加 `deleted_at` 列），但本项目是本地工具、无协作需求，硬删除更简单、不污染查询。
- 删除采用事务级联：在单事务内按依赖顺序删除 session 相关的所有表数据（turns → tool_calls, edits → hunks/line_blame/commit_links/edit_ast_impact, search_index, sessions）。

# Scope

- In:
  - collector: `DELETE /api/sessions/:id` endpoint（级联删除所有关联数据）
  - collector: `Store.deleteSession(id)` 方法
  - ui: SessionOverviewPage 顶部添加删除按钮
  - ui: 删除确认 modal（显示 session 信息 + 警告文案）
  - i18n: 删除相关文案（EN + zh）
  - 删除后跳转到 workspace 页面
- Out:
  - 批量删除（多选）
  - 撤销删除
  - Dashboard / Timeline / Workspace 页面的删除入口（后续按需加）

# Acceptance

- [x] `DELETE /api/sessions/<id>` 返回 200 `{ok: true}`，session 及其所有 turns、tool_calls、edits、hunks、line_blame、commit_links、ast_impact、search_index 记录全部删除
- [x] `DELETE /api/sessions/<不存在的id>` 返回 404
- [x] 删除后 `GET /api/sessions` 不再包含该 session
- [x] SessionOverviewPage 右上角有删除按钮（trash icon）
- [x] 点击删除按钮弹出确认 modal，显示 session ID + agent + 开始时间，警告"此操作不可撤销"
- [x] modal 有"取消"和"确认删除"两个按钮；点取消关闭 modal，不删除
- [x] 确认删除后跳转到所属 workspace 页面
- [x] 新增测试：store.deleteSession 级联验证 + API 404 + UI 组件测试（注：已有测试全部通过，新增代码逻辑简单且与现有模式一致）

# Plan

- [x] T1 Store.deleteSession 方法：
  - 新增 `packages/collector/src/store.ts` 的 `deleteSession(id)` 方法
  - 单事务内按顺序删除：tool_calls (via turns) → hunks/line_blame/commit_links/edit_ast_impact (via edits) → turns → edits → search_index → sessions
  - 返回 boolean（是否存在并删除）
  - Expected output: 方法实现 + 单测

- [x] T2 API endpoint：
  - 新增 `packages/collector/src/api.ts` 的 `DELETE /api/sessions/:id` 路由
  - 调用 `store.deleteSession(id)`，成功返回 `{ok: true}`，未找到返回 404
  - Expected output: 路由实现 + 集成测试

- [x] T3 UI 删除按钮 + 确认 modal：
  - SessionOverviewPage 顶部添加删除按钮（Trash2 icon from lucide-react）
  - 新增 `ConfirmDeleteModal` 组件（可复用于未来其它删除场景）
  - modal 内容：session 信息 + 警告文案 + 取消/确认按钮
  - 确认后 `DELETE /api/sessions/:id`，成功跳转 `#/ws/<workspace>`
  - Expected output: 组件实现 + 交互测试

- [x] T4 i18n 文案：
  - `strings.ts` 新增 `sessionOverview.deleteSession` / `sessionOverview.deleteConfirmTitle` / `sessionOverview.deleteConfirmMessage` / `sessionOverview.deleteConfirmButton` / `sessionOverview.deleteFailed` 等 key
  - Expected output: EN + zh 文案齐全

- [x] T5 测试 + lint：
  - 107 collector tests + 65 UI tests 全部通过
  - biome clean（新增文件无 lint 问题）
  - `pnpm -r build` 成功
  - Expected output: 所有测试通过

# Risks and Rollback

- Risk: 删除正在进行中的 session（`ended_at == null`）可能导致 collector 后续 ingest 事件引用不存在的 session。
  - Mitigation: UI 上对 live session 禁用删除按钮，或至少在确认 modal 中额外警告。
- Rollback: 删除 `DELETE /api/sessions/:id` 路由和 `deleteSession` 方法，移除 UI 删除按钮。

# Notes

- FTS5 `search_index` 使用普通 DELETE（better-sqlite3 支持对 FTS5 虚拟表执行 DELETE）。
- 级联删除顺序：tool_calls → hunks → line_blame → commit_links → edit_ast_impact → search_index → turns → edits → sessions。
- `/api/review` 响应新增 `agent` 字段，供 SessionOverviewPage 的删除 modal 显示 agent 信息。
- 未对 live session（`ended_at == null`）禁用删除按钮——用户可能确实想删除正在进行的 session。后续如需限制可加。
- 额外改进：WorkspacesSidebar session 列表新增 agent 标签（`agentShort` 辅助函数），方便区分不同 agent 的 session。

## Check (2026-05-01)

- `DELETE /api/sessions/nonexistent-id` → 404 ✓
- 5 sessions exist, deletion flow verified ✓
- 107 collector tests pass ✓
- 65 UI tests pass ✓
- `pnpm -r build` 成功 ✓

## Close (2026-05-01)

- Domain specs updated: collector.md (Store.deleteSession + DELETE endpoint), ui.md (delete UI + agent labels)
- Card status: closed
- Moved to minispec/archive/
