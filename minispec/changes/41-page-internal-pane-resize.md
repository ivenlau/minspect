---
id: 41-page-internal-pane-resize
status: done
owner: ivenlau
---

# Why

card 39 只给 ThreePane 的左右侧栏加了拖拽；但三个页面在 main 区域内部还有自己的固定宽度栏，无法拖动：
- BlamePage 右侧 `inspectorPane` 340px（为了共享 selected-line state，不走 ThreePane inspector）
- ReplayPage 右侧 `inspectorPane` 320px
- ReviewPage 左侧 `turnNav` 240px

用户反馈"session 重放、文件 blame 右侧栏还是无法拖动"。

# Approach

- Considered:
  - Option A: 把这些栏提升到 ThreePane 的 sidebar/inspector slot。需要跨组件传页面内部 state（如 Blame 的 selectedLine），App.tsx 会变成中转站，改动大。
  - Option B: 复用 card 39 的 Resizer + paneWidths，加一个 `useResizablePane(config)` hook 封装 state+持久化，页面内部自己接线。
- Chosen: B。三处接线各自 ~6 行，与现有模式一致，不动路由/数据流。

# Scope

- In:
  - `paneWidths.ts` 加 `useResizablePane(cfg)` hook：返回 `{ width, onResize, onReset }`，内部 useState + read/write/clear。
  - 新增三个 PaneConfig：`BLAME_INSPECTOR_PANE`（240–640，默认 340）、`REPLAY_INSPECTOR_PANE`（240–640，默认 320）、`REVIEW_TURNNAV_PANE`（160–420，默认 240）。
  - BlamePage / ReplayPage 在 aside 前插 `<Resizer side="right">`；ReviewPage 在 aside 后插 `<Resizer side="left">`。对应 CSS 去掉固定 width（inline style 提供）。
  - 测试：hook 已有纯函数覆盖，此处补 build/类型验证即可。
- Out:
  - ReviewPage 的 `main` 内部布局（hunk 列宽等）。
  - SessionFilesPage / Overview（无内部固定栏）。
  - 拖动时禁用文本选中已由 Resizer 自带。

# Acceptance

- [x] Given Blame 页 When 拖动右侧 inspector 分隔条 Then 240–640px 内跟随，双击重置 340 — BLAME_INSPECTOR_PANE + Resizer side="right"
- [x] Given Replay 页 When 拖动右侧 inspector 分隔条 Then 240–640px 内跟随，双击重置 320 — REPLAY_INSPECTOR_PANE + Resizer side="right"
- [x] Given Review 页 When 拖动左侧 turns 分隔条 Then 160–420px 内跟随，双击重置 240 — REVIEW_TURNNAV_PANE + Resizer side="left"
- [x] Given 三页宽度 When 刷新 Then 从 localStorage 恢复 — 各自独立 key（minspect.pane.blameInspector / replayInspector / reviewTurnNav），读写复用 readPaneWidth/writePaneWidth（含 clamp）
- [x] Given 现有页面 When 不拖动 Then 布局与之前一致（默认宽度不变） — 三个 CSS 固定 width 移除，由 inline style 提供同值默认

# Plan

- [x] T1 useResizablePane hook + 三个 PaneConfig
  - Expected output: 编译通过 — hook 封装 useState + read/write/clear，deps 为常量 cfg 对象
- [x] T2 三页接线 + CSS 去固定宽
  - Expected output: 三处可拖，默认宽度不变 — Blame/Replay 分隔条在 aside 左侧，Review 在 aside 右侧
- [x] T3 test + build + biome
  - Expected output: ui 测试全绿、build 成功、改动文件 0 lint error — ui 74/74、vite build 成功、biome 干净；daemon 已托管新构建（ui_hash 51d51dd4 一致），刷新即生效

# Risks and Rollback

- Risk: Review 页 turnNav 变宽挤压 prompt 文本 → 文本已有 ellipsis，安全。
- Risk: 多个 Resizer 同页（ThreePane 左 + 页内右）视觉混淆 → 两处独立 localStorage key，行为互不影响。
- Rollback: git revert 单提交。

# Notes

- Blame 的 inspector 不能提升到 ThreePane：`selectedLine` state 在 BlamePage 内部，提升需大改（见 App.tsx inspectorFor 注释）。
