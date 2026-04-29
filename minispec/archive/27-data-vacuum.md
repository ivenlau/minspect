---
id: 27-data-vacuum
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: cli
---

# Why

两处数据卫生问题：
1. **Orphan line_blame rows**：上卡 24 smoke test 时发现很多 turn_id 指向已删 turns（~50% 行）。blame 视图 turn chip 显示 `?` —— 不是 bug 但视觉上有损。
2. **Poison queue 不可见**：statusbar 显示 "106 poisoned" 但用户没法看是哪些事件、什么原因。已经堆了上百个无人查看。

# Approach

新 CLI 子命令 `minspect vacuum` 做三件事：扫孤儿行、列 poison、按 flag 决定清理。UI 加一个轻量 drawer 给 poison 查看。

# Scope

- In:
  - `packages/cli/src/commands/vacuum.ts`：新子命令
    - `minspect vacuum --dry-run`（默认）：列出孤儿 blame 行计数 + poison 事件数 + 建议操作
    - `minspect vacuum --fix`：DELETE orphan line_blame；orphan blobs(自引用检查后删)
    - `minspect vacuum --clear-poison`：删 `queue/.poison/*.json`（保留前先提示用户）
  - `packages/cli/src/bin.ts`：注册
  - `packages/collector/src/api.ts`：`/api/queue/poison` 返回最近 50 个 poison 事件预览（type + session_id + timestamp + error reason if 可推断）
  - UI：StatusBar 的 "poisoned: N" 文本变成可点击 → 弹 drawer 列表
  - 测试：vacuum 命令 3 场景 + poison 端点 1
- Out:
  - Auto-vacuum（定时任务）
  - 跨 DB 迁移工具
  - Blob 实际物理 shrink（SQLite `VACUUM` 命令）—— 可以后续加

# Acceptance

- [ ] `minspect vacuum --dry-run` 输出 "would delete N orphan blame rows, M poison events"，不改任何数据
- [ ] `minspect vacuum --fix` 后 `SELECT COUNT(*) FROM line_blame WHERE turn_id NOT IN (SELECT id FROM turns)` 返回 0
- [ ] `minspect vacuum --clear-poison` 后 `queue/.poison/` 空
- [ ] UI statusbar 点 "poisoned: N" 弹 drawer，列出事件 + reason
- [ ] 测试全绿

# Plan

- [ ] T1 collector `/api/queue/poison` 端点
- [ ] T2 CLI vacuum 命令 3 模式
- [ ] T3 UI poison drawer
- [ ] T4 tests + docs
- [ ] T5 close

# Risks and Rollback

- Risk: 删错数据。Mitigation: dry-run 默认，confirm prompt before destructive flags。
- Rollback: vacuum 命令随时可删除；poison drawer 是独立入口，移除无连带影响。

# Notes

- Orphan 产生的根因是之前的 schema + 不完整的 event queue drain（见卡档）。已修，但残留要清。

## Execution notes (2026-04-28)

- **CLI 命令**：`minspect vacuum [--fix] [--clear-poison]`。dry-run 默认；`--fix` 删 orphan line_blame + orphan blobs；`--clear-poison` 删 `queue/.poison/*.json`。报告分两段：发现数 + 已删数。
- **Orphan blobs 清理**：同步也把没有 edits 引用的 blobs 删掉（一次 cleanup 就能 shrink 文件）
- **`/api/queue/poison`**：最多 50 条最近事件 + filename + size + type + session_id，够 UI drawer 用
- **UI drawer**：StatusBar 的 "poisoned: N" 从文本变成按钮，点击覆盖 drawer 从底部升起，列事件 + 提示用户运行 `minspect vacuum --clear-poison`。read-only —— UI 不执行 destructive ops
- **Tests**：4 个 CLI vacuum 测试（dry-run / --fix / --clear-poison / missing state dir）

## Check

- `pnpm -r test` 218 tests pass（cli +4, collector +0 since API endpoint not unit-tested）
- biome clean
- 端到端手验：`minspect vacuum` 显示 "orphan blame rows: N, quarantined: 106"；`--clear-poison` 后计数归零

## Close

- `specs/cli.md` 加 `minspect vacuum` 条目
- 卡归档
