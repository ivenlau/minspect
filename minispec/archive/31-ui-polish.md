---
id: 31-ui-polish
status: closed
owner: ivenlau
closed: 2026-04-28
---

# Why

一堆小颗粒 UI 疏漏合并在一张卡：
1. Session overview 点 turn 跳 Review 带 `#turn-<id>` anchor，Review 页不滚动
2. Fetch 中白屏（无 skeleton / spinner）
3. 8+ 处 "No xxx yet" empty state 文案和图标不一致
4. `ended_at == null` 的 session 没有"进行中"视觉标记

# Approach

每个都是 10-30 行改动，批量做。用 lucide icon 统一 empty state + 小 helper 组件 `EmptyState`。

# Scope

- In:
  - `useHashAnchor` hook：监听 `location.hash` 里的 `#anchor` 部分，triggered 时 `document.getElementById(anchor)?.scrollIntoView()`
  - Review/Session pages 调用它（挂在 App.tsx 一次，所有路由都生效）
  - `EmptyState` 组件：lucide icon + title + subtitle + optional compact
  - 所有现有 "No xxx" 统一用 EmptyState
  - `Skeleton` primitive + `LiveDot` dot：灰色 pulse + 进行中绿点
  - Session live indicator：`ended_at == null` 绿色 pulsing dot（CSS animation）
- Out (延后)：
  - 每页面 first-paint skeleton 占位（后续 UI 迭代）。EmptyState + LiveDot 已覆盖 card 的主要痛点；Skeleton primitive 已提供但暂未在每个页面初次加载注入。
  - 全站 loading 状态重做
  - Theme 切换（dark-only 继续）
  - 动画系统引入（用纯 CSS，不引 framer-motion）

# Acceptance

- [x] Session overview 点 turn → Review 页滚到对应 card（useHashAnchor 在 App 根部挂载，监听 `hashchange` 和 mount-time，`requestAnimationFrame` 后 scrollIntoView）
- [x] 所有 empty state 用统一组件 + icon（9 处替换：WorkspacesSidebar、TimelinePage、DashboardPage x2、WorkspacePage x2、BlamePage x2、ReviewPage x2、ReplayPage x2、SessionFilesPage x2、SessionOverviewPage x2、FileTreeSidebar）
- [x] 进行中 session 左侧有绿色脉冲点（WorkspacesSidebar、TimelinePage、WorkspacePage 的 sessions 表格）
- [x] biome clean，tests pass（213 tests 全绿）
- [~] 每个页面 fetch 中有 skeleton 或 spinner（primitive 已交付，页面级挂接暂未做。现有 usePoll 在 fetch 中保持上一次数据，没有明显的"白屏"体验）

# Plan

- [x] T1 `useHashAnchor` hook（挂在 App.tsx 根组件）
- [x] T2 `EmptyState` 组件 + 替换所有 "No xxx yet"
- [x] T3 `Skeleton` primitive + `LiveDot` 导出（skeleton 留作后续 first-paint 占位用）
- [x] T4 Live indicator CSS + wire 到 WorkspacesSidebar / TimelinePage / WorkspacePage
- [x] T5 close

# Risks and Rollback

- Risk: 低。所有改动纯 UI 加料。
- Rollback: 单点回退，每个 T 独立。

# Notes

- Live indicator 脉冲动画用 CSS `@keyframes`，1.8s 周期 opacity 0.6 → 1.0 → 0.6 + box-shadow 扩散（绿色 rgba）
- useHashAnchor 选择挂在 App 根而不是每页逐个调用，避免重复代码；它监听 hashchange 并在 mount 时跑一次，兼顾"刚打开页面 URL 里就有 anchor"和"点击跳转后换 anchor"两种情况
- 实际替换点清单：
  - `WorkspacesSidebar.tsx`: 空 workspaces → `<EmptyState icon={FolderPlus}>`
  - `TimelinePage.tsx`: 空 sessions → `<EmptyState icon={Clock}>` + 每行 live dot
  - `DashboardPage.tsx`: 空 top_workspaces / 空 recent → `<EmptyState>` (compact / 带子标题)
  - `WorkspacePage.tsx`: 空 sessions / 空 files → `<EmptyState>` + sessions ID 后 live dot
  - `BlamePage.tsx`: error state / 空内容 → `<EmptyState icon={AlertCircle / FileText}>`
  - `ReviewPage.tsx`: error / 空 matches → `<EmptyState>`（区分 "no turns yet" vs "filter empty"）
  - `ReplayPage.tsx`: error / 空 steps → `<EmptyState icon={Film}>`
  - `SessionFilesPage.tsx`: error / 空 files → `<EmptyState>`
  - `SessionOverviewPage.tsx`: error / 空 turns → `<EmptyState>`
  - `FileTreeSidebar.tsx`: 空 files → `<EmptyState>`
- `WorkspacesSidebar.module.css` 清理：未使用的 `.empty` / `.dotOk / .dotWarn / .dotDanger` 删除（LiveDot 替代了 dotOk）
