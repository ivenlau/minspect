---
id: 18-replay-diff-and-toolcall-granularity
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: ui
---

# Why

卡 17 MVP 的 Replay 只能 turn 级翻页，看不到具体 diff。Review 刚补齐 diff/filter/export 后，Replay 反倒成退化体验。

# Approach

Tool_call 粒度扁平化 + 复用 Review 的 `renderHunk` + 键盘 ← → Home End。MultiEdit 一次合并为一步；空 turn 占位一步。

# Scope / Acceptance / Plan

全部勾选，见 changes/18。

## Execution notes (2026-04-28)

- `showReplay` 重写：`flattenReplaySteps(turns)` 扁平化，按 `tool_call_id` 分组；模块级 `replayKeyHandler` 随路由生命周期管理。
- 零 API / schema / 测试改动；UI 纯浏览器逻辑。
- 120 tests 全绿；build + lint clean。

## Check

- build 5 包通过；`Checked 85 files`, no lint errors。
- 端到端手验：`#/replay?session=<id>` 可用 / MultiEdit 正确合并 / 键盘快捷键响应并在路由切换时解绑。

## Close

卡自 `changes/` 归档；`specs/ui.md` 的 Replay 说明后续补一笔（下次触碰 UI spec 时）。
