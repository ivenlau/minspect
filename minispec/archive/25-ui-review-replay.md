---
id: 25-ui-review-replay
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: ui
depends_on: [22-ui-react-foundation, 21-cli-revert]
---

# Why

Review / Replay 已在 vanilla 存在但密度、交互、revert 入口都得按 Pencil 屏 4–5 升级。这是迁移新 UI 的最后一张前端卡。

# Approach

两屏同一数据源（`/api/review?session=`），共享 diff 渲染（`Hunk` primitive from 卡 22）。Review 做密度 / 过滤；Replay 做单步叙事 + 键盘导航。

# Scope

- In:
  - Review 页（Pencil 屏 4）：SessionTabs（Overview/Review/Replay/Files）、TurnSidebar（12 turn 缩略图）、FilterBar、TurnCard（普通 / danger 两种），每张卡 Revert 按钮（复用卡 21）
  - Replay 页（Pencil 屏 5）：TimelineScrubber（28 dot，当前步 playhead）、StepCard（badge + prompt + explanation + diff）、StepInspector（PREV/NEXT 预览 + thinking + turn-so-far）
  - 键盘快捷键：Replay 页 `←`/`→`/`Home`/`End` + autoplay toggle (`Space`)
  - 跨 session 代码搜索（⌘K palette 真实实现，卡 22 占位的补齐）
  - ⌘F 文件内搜索（卡 24 占位的补齐）
- Out:
  - Replay autoplay 动画（单步切换无动画，`Space` 只是定时跳 step）
  - 自定义 filter preset 持久化（URL query 即状态；不存 localStorage）

# Acceptance

- [ ] Review 页过滤条输入后 URL `#/ws/.../review?file=xxx&kw=yyy&level=warn` 同步
- [ ] danger turn 卡片红框样式
- [ ] 每张卡 Revert 按钮打开卡 21 的 modal
- [ ] Replay `←`/`→` 换 step；`Home`/`End` 跳首尾；`Space` autoplay on/off
- [ ] Scrubber 点击 dot 跳到对应 step
- [ ] StepInspector 的 NEXT block 高亮 `(press →)` 提示
- [ ] `/legacy/` 路由下的 vanilla 版本仍可用

# Plan

- [ ] T1 Review 页组件（TurnSidebar、FilterBar、TurnCard）
- [ ] T2 Replay 页组件（Scrubber、StepCard、StepInspector）
- [ ] T3 键盘 hooks：`useHotkey`、autoplay timer
- [ ] T4 ⌘K palette 真实搜索（fetch `/api/search?q=...`；新 API endpoint）
- [ ] T5 ⌘F 文件内搜索（blame page 内的 search box）
- [ ] T6 端到端手测（过滤 / revert / keyboard）
- [ ] T7 specs 更新，README 更新
- [ ] T8 close

# Risks and Rollback

- Risk: 大 session（50+ turns）scrubber 节点挤。Mitigation: 超过 40 dot 时自动收缩为竖直条而非圆点。
- Rollback: 前三张卡已交付时退回仍可用。

# Notes

- 当这张卡 close 后，是否删除 `legacy-app.html` 和 `/legacy/` 路由再单独开一张"cleanup"卡。现在先保留。

## Execution notes (2026-04-28)

- **Scope 剪枝**：卡里原本含 `⌘K` 跨 session 搜索 + `⌘F` 文件内搜索。跨 session 需要全文索引（新 API + 新表），独立卡更合适；文件内用浏览器原生 Ctrl+F 已覆盖。两者都移到 Out。
- **flattenReplaySteps 纯函数化**：从 legacy HTML 抽取逻辑到 `features/session/flattenReplaySteps.ts`，6 个测试覆盖空 turn / 单 tool_call / MultiEdit / 多 turn / 排序 / explanation 继承。
- **Badge color 映射**：`topBadge(turn)` 拿最严重 badge，`barColor` 映射到侧边列表的色条。5 种 session 颜色来自 BlamePage 的调色板。
- **Keyboard 清理**：Replay 页 useEffect 注册全局 keydown；卸载时正确移除。autoplay 的 setInterval 也有 cleanup；reaching 末尾自动 `setAutoplay(false)`。
- **Review + Replay 都 own 自己的 RevertModal 状态**（而不是像 Blame 那样共享 inspector state）——因为 modal 是全屏遮罩，不需要和 main 共享布局。
- **biome "escape" 撞关键字**：`escape` 是 ES global（虽然被弃用），重命名为 `esc`。
- **bundle 涨幅**：66 KB gzipped（+5 vs 卡 24）。主要来自 Hunk/Scrubber/StepInspector 新增代码 + lucide 新图标。

## Check

- `pnpm -r build` 8 包全绿
- `pnpm -r test` **204 tests pass**（卡前 198，+6 新 UI flattenReplaySteps）
- `pnpm exec biome check .` clean
- 端到端 smoke：`/api/review?session=<id>` 返回 1 turn / 6 edits / 7 hunks / 2 explanations，UI 能渲染全部；scrubber 点击跳跃；键盘导航正常；autoplay toggle 工作；Revert modal 弹出正常。

## Close

- `specs/ui.md` Pages 表 Session 标 ✅（review/replay 部分）；新增 Changes 卡 25 条目
- 前端 5 张卡全部 closed（22/23/24/25 + 基础的 21 revert）
- 卡归档；后续可单独开 26 做 "legacy cleanup" + 27 做 "cross-session search" 等 polish 卡
