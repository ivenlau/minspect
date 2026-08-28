---
id: 40-sidebar-session-datetime
status: done
owner: ivenlau
---

# Why

sidebar 的 session 行时间只显示 `HH:MM`。session 跨天很常见，加上现在侧栏宽度可拖（card 39），窄栏 `HH:MM` 够用但宽栏应该显示完整的 `2026-08-21 12:23`。用户明确要求：宽度足够时显示日期+时间。

# Approach

- Considered:
  - Option A: 始终显示完整 `YYYY-MM-DD HH:MM`，溢出截断。窄栏时 session id 会被挤没，信息密度反而下降。
  - Option B: 容器查询（CSS `@container`）控制两种时间格式切换。纯 CSS 优雅，但 jsdom 不支持容器查询、也无法对格式逻辑单测，且需要把宽度断点和实际字符串耦合在 CSS class 上。
  - Option C: sidebar 宽度本来就是 state（ThreePane），把宽度传给 sidebar，JS 里按阈值切换格式（≥340px 显示完整日期+时间，否则维持 HH:MM），格式化函数抽纯函数单测。
- Chosen: C。数据已就位（sideW 在 ThreePane state 里），阈值切换逻辑可测，窄栏行为不变。

# Scope

- In:
  - `ThreePane.tsx`：把 `sideW` 通过 props 传给 `sidebar`（改为 render-prop 或新增 prop `sidebarWidth`——采用给 children 传上下文最简单的方式：直接在 ThreePane 内给 sidebar 包一个 context provider）。
  - 新增 `packages/ui/src/layout/sidebarWidth.ts`：轻量 context（`SidebarWidthContext` + `useSidebarWidth`）。
  - `WorkspacesSidebar.tsx`：`timeOfDay` 升级为 `fmtSessionTime(ts, wide)`——wide 时 `YYYY-MM-DD HH:MM`（与 WorkspacePage 的 fmtTime 同格式），否则 `HH:MM`；时间列 `flex-shrink: 0` 防挤压。
  - 测试：`fmtSessionTime` 纯函数用例（宽/窄两种格式、个位数月日时补零）。
- Out:
  - tooltip / WorkspacePage 的时间格式（已是完整格式）。
  - FileTreeSidebar（无时间列）。
  - i18n 日期格式本地化（固定 ISO 风格，与现有 fmtTime 一致）。

# Acceptance

- [x] Given sidebar 宽度 ≥340px When 渲染 session 行 Then 时间显示 `YYYY-MM-DD HH:MM`（如 `2026-08-21 12:23`） — `sideW >= WIDE_SIDEBAR_PX` 时用 fmtDateTime
- [x] Given sidebar 宽度 <340px When 渲染 session 行 Then 时间维持 `HH:MM` — 原 timeOfDay 行为不变（改为委托 fmtTimeOfDay）
- [x] Given 月份/日期/时/分个位数 When 格式化 Then 全部补零两位 — time.test.ts 用例 `2026-01-03 04:05` / `08:09`
- [x] Given 拖动分隔条 When 跨越阈值 Then 无需刷新即时切换格式 — sideW 是 React state，context 直接驱动重渲染
- [x] Given 时间列 When 窄栏挤压 Then 时间不被截断（flex-shrink:0），session id 承担省略 — sessTime 加 flex-shrink: 0

# Plan

- [x] T1 新增 SidebarWidthContext + useSidebarWidth
  - Expected output: 编译通过，ThreePane 提供值 — ThreePane 用 Provider 包裹 aside
- [x] T2 WorkspacesSidebar 时间列切换格式 + CSS flex-shrink
  - Expected output: 宽窄两种渲染正确 — 顺带把 WorkspacePage 的 fmtTime 改为共享 fmtDateTime 的别名，消除重复实现
- [x] T3 fmtSessionTime 单测 + build + biome
  - Expected output: ui 测试全绿、build 成功、改动文件 0 lint error — ui 74/74（新增 3 用例）、vite build 成功、biome 干净；daemon 已托管新构建（ui_hash 84b511b7 一致），刷新即生效

# Risks and Rollback

- Risk: 阈值 340 与实际内容宽度（icon+id+agent tag+time）不完全吻合 → 可后续微调常量；不影响数据。
- Risk: context 引入让 sidebar 渲染对宽度敏感，每次拖动 re-render 整个 sidebar → 行数有限（200 上限由 API 决定），可接受。
- Rollback: git revert 单提交。

# Notes

- 复用格式：与 `WorkspacePage.tsx` 的 `fmtTime` 输出完全一致，抽到共享工具 `components/time.ts`，两处共用。
- 阈值取 340：默认 240px（HH:MM）+ 拖到约 340px 才放得下 16 字符 mono 时间。
