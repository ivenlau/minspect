---
id: 39-draggable-pane-resize
status: done
owner: ivenlau
---

# Why

左右侧边栏（workspaces 文件树 / inspector）是固定宽度（240px / 320px）。workspace 路径很长（上一张卡实测 110–130 字符），固定宽度经常截断；用户希望能手动拖动调整宽度。

# Approach

- Considered:
  - Option A: 引入第三方库（react-resizable-panels 等）。功能全但违背项目"依赖克制"约束，为一个拖拽引入 ~10KB 不值。
  - Option B: 手写一个 ~60 行的 `useResizable` hook（pointer events + localStorage 持久化 + min/max clamp），只在 `ThreePane` 挂两根拖拽条。
- Chosen: B。拖拽需求很简单（单轴、两根分隔条），手写可控且无依赖。

# Scope

- In:
  - 新组件 `packages/ui/src/components/Resizer.tsx`：竖向拖拽条（pointerdown/move/up，`col-resize` 光标，双击重置默认宽度）。
  - `ThreePane.tsx/.module.css`：`.side` / `.inspector` 宽度改为 state 驱动 inline style，两栏各插一根 Resizer；宽度持久化到 localStorage（`minspect.pane.sidebar` / `minspect.pane.inspector`，读写 try/catch 防 blocked）。
  - 约束：sidebar 180–480px，inspector 240–640px，默认 240/320 不变；拖动中 `user-select: none` 防止选中文本。
  - 测试：Resizer 逻辑（clamp/持久化/双击重置）尽量抽纯函数测；至少保证现有测试与 build 全绿。
- Out:
  - BlamePage 内部 FileTreeSidebar 与代码区的比例（页面内布局，不动）。
  - 折叠/展开侧栏（只调宽度，不做收起）。
  - 移动端 / 触屏适配。

# Acceptance

- [x] Given 页面加载 When 用鼠标拖动左侧分隔条 Then sidebar 宽度跟随鼠标，clamp 在 180–480px — Resizer pointerdown/move 用 startRef 记录起点，onResize 前先 clamp；paneWidths.test.ts 覆盖 clamp 边界
- [x] Given 拖动后 When 刷新页面 Then 宽度从 localStorage 恢复 — writePaneWidth/readPaneWidth round-trip 测试通过
- [x] Given 双击分隔条 When Then 该栏宽度重置为默认值（240 / 320） — onDoubleClick → onReset（清 localStorage + setState 默认值）
- [x] Given inspector 不存在的页面（Dashboard）When 拖动 Then 仅左侧可拖，右侧无分隔条、布局不回归 — inspector 为 falsy 时 Resizer 与 aside 一并条件渲染
- [x] Given 拖动中 When 划过文本 Then 不触发文本选中 — dragging 时 document.body.style.userSelect = 'none'，pointerup/cancel 恢复

# Plan

- [x] T1 新增 Resizer 组件（pointer events、clamp、双击重置、a11y title）
  - Expected output: 组件编译通过，光标/禁选中行为就位 — role="separator" + aria-valuenow，col-resize 光标，hover/拖动中分隔线高亮 accent 色
- [x] T2 ThreePane 接线：state + localStorage 持久化 + inline width
  - Expected output: 两栏可拖，刷新后保持 — paneWidths.ts 纯函数模块（读/写/清/clamp），i18n 双语 label
- [x] T3 测试 + lint + build
  - Expected output: `pnpm -C packages/ui test` / `pnpm lint`（改动文件） / `pnpm -C packages/ui build` 全绿 — ui 71/71（新增 paneWidths 6 用例）、biome 改动文件 0 error、vite build 成功；daemon（pid 93812）已托管新构建（ui_hash cb259316 一致），浏览器刷新即生效

# Risks and Rollback

- Risk: pointer capture 在某些浏览器/嵌入场景（PWA standalone）表现差异 → 只用标准 setPointerCapture，且 move 监听 window 兜底。
- Risk: localStorage 存了越界值（如手动改过）→ 读取时同样 clamp。
- Rollback: git revert 单提交。

# Notes

- 现状：`.side { width: 240px }`、`.inspector { width: 320px }`（ThreePane.module.css），全部页面共用 ThreePane，改一处全站生效。
- Blame 页的 inspector 是 BlamePage 自己渲染的（App.tsx `inspectorFor` 返回 undefined），本次不动；若后续要拖，复用同一个 Resizer。
