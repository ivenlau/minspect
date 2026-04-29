---
id: 23-ui-dashboard-workspace
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: ui
depends_on: [22-ui-react-foundation]
---

# Why

卡 22 的 shell 落下后 Dashboard / Workspace 仍是 stub。用户实际价值要到这张卡才显现：一打开就能看到跨 workspace 的活动概览和按项目分组的 session。

# Approach

两条独立但数据源相关的屏复用同一批组件，合并在一张卡里做完；按 Pencil mockup 原样对齐。

# Scope

- In:
  - **新 API**：
    - `GET /api/dashboard` → `{activity: [{day, edits}] (30d), topWorkspaces, topAgents, alerts (from detectors), recentActivity (last 50 events)}`
    - `GET /api/workspaces/:encodedPath` → `{path, sessionCount, turnCount, editCount, filesTouched, agents, sessions, filesTree}`
  - **Dashboard 页**（Pencil 屏 1）：ActivityCard (30 bar sparkline)、TopWorkspacesCard、TopAgentsCard、AlertsCard、RecentActivityCard（每 5s 轮询）
  - **Workspace 详情页**（Pencil 屏 2）：StatRow 四个小卡 + SessionsTable + FilesTree 两列布局 + 右 Inspector
  - 复用卡 22 的 primitives：Card、Tree、Badge、Pill
- Out:
  - Dashboard 活动图的时间范围切换（30d 硬编码）
  - Workspace Inspector 的真实内容（卡 24 Blame 上再打磨）
  - "Open in editor" 按钮（VS Code URI scheme 集成，后续单独卡）

# Acceptance

- [ ] `/` 默认显示 Dashboard（不再是 Timeline 列表）
- [ ] 点左侧 workspace 导航到 `#/ws/<path>`，渲染 Workspace 详情
- [ ] Dashboard 所有卡片数据实时（manual smoke：跑一次 Claude Code → 10s 内 recent activity 出现新条目）
- [ ] Sessions 表三个 session 场景（active/完成/有 ⚠ badge）视觉和 Pencil 一致
- [ ] Files tree 正确聚合 edit 数、可展开嵌套目录
- [ ] pnpm -r test + lint 全绿

# Plan

- [ ] T1 `/api/dashboard` 实现 + test
- [ ] T2 `/api/workspaces/:path` 实现 + test
- [ ] T3 Dashboard 页组件
- [ ] T4 Workspace 页组件
- [ ] T5 Workspace Inspector stub（只显示选中文件的统计 + 占位 actions）
- [ ] T6 specs/ui.md + specs/collector.md 更新
- [ ] T7 close

# Risks and Rollback

- Risk: activity sparkline 数据聚合查询在大 DB 上慢。Mitigation: 查询加 `edits.created_at` 索引（若无）。
- Rollback: 退回卡 22 shell 状态，Dashboard 改显示 Timeline。

# Notes

- 遵循 Pencil 原 mockup 密度、颜色、文案。

## Execution notes (2026-04-28)

- **Dashboard 活动图**：30 个柱子，缺日补 0。opacity 按 `edits / maxEdits >= 0.7` 切换 1.0 / 0.6，保留 Pencil mockup 的"峰值突出"质感。
- **delta_pct**：对比前 30 日总量；前 30 日无数据返回 `null` → UI 显示 `—`（别计算为 Infinity）。
- **Alerts 聚合逻辑**：detectors 本来是 per-turn 返回 badges；这里把同 level+id 的 badge 合并计数，danger > warn > info 排序。
- **Inspector 面板**：Workspace 路由下右侧自动显示 Inspector（卡 22 的 ThreePane 支持可选 inspector）。Dashboard / Timeline 下没有（2 窗格）。
- **File list 排 direction:rtl trick**：让长路径从左边截断、右边显示文件名和扩展名；IDE 文件树常用手法。
- **a11y lint 整活**：feed row、session row、file row 全改为 `ClickRow`。顺便把 ClickRow.module.css 的 `display:flex` 删掉让 caller 决定（grid / flex 都可）。

## Check

- `pnpm -r build` 8 包全绿
- `pnpm -r test` **190 tests pass**（卡前 187，+3 新 collector tests）
- `pnpm exec biome check .` clean
- 端到端 smoke（`minspect serve` + curl）：`/api/dashboard` 返回 30 days activity + 146 edits + 100% claude-code + 3 alerts + 36 recent events；`/api/workspaces/<ttt>` 返回 4 sessions, 7 turns, 19 edits, 2 files + top file snake.html (15 edits)
- 浏览器手验：打开 `/` 看到 Dashboard；点左 workspace 进 Workspace 详情；点 file 行跳 blame stub（卡 24 接）；Inspector 正确显示 agents + last activity

## Close

- `specs/ui.md` 更新：API 表新增 `/api/dashboard` 和 `/api/workspaces/:path`；Pages 状态表标记 Dashboard / Workspace 为 ✅；新增 Changes 条目
- 卡 24 (Blame) / 25 (Review+Replay) 继续按依赖顺序推进
- 卡归档
