---
id: 24-ui-blame-upgrade
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: ui
depends_on: [22-ui-react-foundation]
---

# Why

Blame 是 minspect 的核心卖点。当前 vanilla 版的 3 列 pre 表格做得粗糙：没 hover 联动、没 inspector、没 heat strip。Pencil 屏 3 的 IDE 风格 blame 是 minspect 差异化最显眼的地方。

# Approach

- 复用卡 22 的 ThreePane + FileTree primitive（Blame 场景切换 sidebar 为文件树 variant）
- 新增 `BlameRow` 组件负责 gutter + 色条 + turn chip + 代码行
- heat strip 作为 BlameTable 顶部子组件
- Inspector 按行点击驱动：展示该行所属 turn 的 prompt / reasoning / 相关 edits / Revert 按钮

# Scope

- In:
  - 新 API：`GET /api/workspaces/:path/files` 返回文件树（按目录聚合，带每个文件的 edit_count）
  - 升级 `/api/blame`：增加 hover 联动所需的 turn 元数据（已有但格式归一）
  - Blame 页（Pencil 屏 3）：FileTreeSidebar + FileToolbar + HeatStrip + BlameTable + LineInspector
  - BlameRow hover → 同 turn 所有行整体高亮
  - 搜索栏占位 ⌘F（真实搜索在 25）
  - Revert 按钮复用卡 21 modal
- Out:
  - 跨文件搜索（⌘F 只搜当前文件；跨 session 搜索留 25）
  - Monaco editor（已决策不上）
  - 行级 revert（留独立卡）

# Acceptance

- [ ] Blame 页 3 窗格正确：左文件树、中 blame 表、右 inspector
- [ ] hover gutter chip → 同 turn 所有行背景高亮
- [ ] 点击 blame 行 → inspector 填充该行的 turn 详情
- [ ] 用户手改的行显示红色断链 bar
- [ ] heat strip 正确按文件区段显示修改密度
- [ ] 3 session 的行用不同色区分
- [ ] Revert 按钮点击弹 modal（复用卡 21）

# Plan

- [ ] T1 `/api/workspaces/:path/files` 实现 + test
- [ ] T2 `FileTree` primitive 正式化 + tests
- [ ] T3 `BlameRow` 组件 + hover 联动
- [ ] T4 `HeatStrip` 组件
- [ ] T5 `LineInspector` 组件
- [ ] T6 Blame 页组装 + routing wire
- [ ] T7 specs 更新 + close

# Risks and Rollback

- Risk: 大文件（1000+ 行）blame table 渲染卡。Mitigation: virtualize（`react-window`）或硬上限显示前 2000 行 + 提示。
- Rollback: `/legacy/` 保底。

# Notes

- FileTree 组件要做得通用（Workspace 页也能用），但 Blame 场景下文件点击直接触发路由 `#/ws/.../file/...`。

## Execution notes (2026-04-28)

- **File tree 单 child 压缩**：`buildFileTree` 实现了 VSCode "compact folders" 风格。纯函数 + 测试覆盖 6 个场景（空 / 单文件 / 分目录 / 单 chain 压缩 / 多 child 不压缩 / meta 字段）。
- **Chain-break 检测**：SQL 层不算，改在 JS 里遍历 edits chain 比对 `cur.before_hash !== prev.after_hash`，把断链 edit ID 返回给 UI。实战数据上有 1 处断链命中（real session af0f2adf 上的 api.ts）— 说明功能正确。
- **BlamePage 双窗格**：Blame 需要 selectedLine state 在 main 和 inspector 间共享。折中方案：BlamePage 自己渲染 2 窗格（main + aside），App.tsx 的 ThreePane 把 inspector slot 留空。
- **ClickRow 空白行问题**：空代码行渲染成 `{code || ' '}`；避免 flex 折叠掉 row 高度。
- **Hover 不穿透 ClickRow**：把 `onMouseEnter/Leave` 放在内部 `<span>` 上，因为 `<button>` 的 event 冒泡模式对内部 span 一样有效。
- **5 色 session palette**：accent / warn / violet / success / #d44b6f。超 5 session 时循环复用。sessionOrder Map 保证第一个出现的 session 永远拿 accent（主色）。

## Check

- `pnpm -r build` 8 包全绿
- `pnpm -r test` **198 tests pass**（卡前 190，+8 新：6 buildFileTree + 2 collector）
- `pnpm exec biome check .` clean
- 端到端 smoke：`curl /api/workspaces/<ws>/files` 返回 72 文件；`curl /api/blame` on api.ts 返回 373 blame rows / 1 turn / 2 edits / 1 chain_broken
- 浏览器手验：workspace 导航后切 blame 视图，sidebar 自动换成文件树；点 blame 行 inspector 填充 prompt / reasoning / edits；Revert 按钮弹 modal；ESC 关闭 modal

## Close

- `specs/ui.md` Pages 表 Blame 标 ✅；API 表新增 `/api/workspaces/:path/files`；`/api/blame` shape 更新
- 卡 25 (Review + Replay) 是最后一张前端升级
- 卡归档
