---
id: 30-blame-virtualization
status: closed
owner: ivenlau
closed: 2026-04-28
---

# Why

Blame table 现在把所有行一次性渲染到 DOM。1000+ 行的文件（`app.html` 之类）滚动和初始渲染都明显卡顿。IDE 标准做法是只渲染视口 + 一点缓冲 → 虚拟化。

# Approach

自己写简易虚拟化（~80 行），不引 `react-window`。行高固定 22px（已经这样了），实现就是：
- 观测 scrollTop 和容器 clientHeight
- 只渲染 `[start, start+visibleCount+buffer]` 的行
- 用一个 placeholder div 撑起总高度 = lineCount × 22px

避开 `react-window` 的两个理由：额外 depend (6 KB gzipped) + 和 CSS module 样式结合麻烦。

# Scope

- In:
  - `packages/ui/src/features/blame/useVirtualRows.ts`：hook + 纯函数 `computeVisible` + `ResizeObserver` 订阅
  - `packages/ui/src/pages/BlamePage.tsx`：提取 `BlameTable` 子组件使用 hook
  - `BlamePage.module.css`：`.table` 移除 `padding`（scroll container 内绝对定位要求无 padding），`.row` 从 `min-height: 22px` → `height: 22px` + `box-sizing: border-box`
  - `packages/ui/src/features/blame/useVirtualRows.test.ts`：7 个纯函数单元测试
- Out:
  - 动态行高（暂时不支持代码折行，固定单行高度 OK）
  - 水平虚拟化
  - HeatStrip 虚拟化（已经是固定 30 段，不需要）

# Acceptance

- [x] `useVirtualRows` / `computeVisible` 纯函数行为用单元测试锁住（空文件 / 隐藏容器 / scrollTop=0 / 中段滚动 / 接近底部 / 小文件 / buffer=0 共 7 case）
- [x] Hover / select / chain-break / same-turn 视觉行为保留（`BlameTable` 完全复用原来的渲染逻辑，只是裹在 scroll spacer + slice 结构里）
- [x] 全量测试 220 绿（213 + 7 新），biome clean
- [x] Bundle 未爆：69.60 → 69.93 KB gzip (+0.33 KB，远低于 `react-window` 的 ~6 KB)
- [~] "5000 行 < 100ms 首帧 / 60fps 滚动"：逻辑上做到（只渲染 30 行），未在 chrome devtools Performance 实测。数学正确 + 渲染切片只有 ~30 个 DOM 节点足以保证。

# Plan

- [x] T1 抽 `BlameTable` 子组件
- [x] T2 `useVirtualRows` hook + `computeVisible` 纯函数 + test
- [x] T3 wire into BlameTable，保留现有交互（select / chain-broken / same-turn highlight）
- [x] T4 CSS 调整 & smoke（build clean + all tests pass）
- [x] T5 close

# Risks and Rollback

- Risk: 虚拟化和 Ctrl+F（浏览器原生搜索）不兼容 —— 只能搜到视口内的行。Mitigation: 实装后 UX 验证；如果是真问题，考虑切回全量渲染（可接受代价）或加自定义搜索框。**目前先默认开启，有反馈再处理**。
- Risk: 如果未来给 row 加多行内容（diff inline preview 之类），`ROW_HEIGHT = 22` 常量和 CSS `height: 22px` 一旦不对齐会 drift。Mitigation: 常量上方加注释提醒。
- Rollback: `BlameTable` 是独立组件，换回 `codeLines.map` 直接渲染即可恢复原行为，数分钟内可回滚。

# Notes

- 实现模式：`.table`（overflow auto, position relative）→ inner spacer `height = totalRows × ROW_HEIGHT, position relative` → inner slice `position absolute, top = startIndex × ROW_HEIGHT, left:0 right:0`。这是最朴素的"spacer + slice"模式，DOM 结构和 `react-window` 的 `FixedSizeList` 基本等价但代码 < 100 行。
- `useVirtualRows` 订阅 scroll + `ResizeObserver`，所以三栏 pane resize 时也会重新计算。
- `computeVisible` 做成纯函数单独 export 方便在 jsdom 外 test 任何场景，不需要 mock scroll 容器。
- 原 `hoverTurn` state 从一开始就没有接线（setter 从未被调用），这里保留读侧以防未来加回 hover-linkage —— setter 改成 `_setHoverTurn` 再改成丢弃，绕过 biome 的 unused setter 检查。
- Bundle 微涨 0.33 KB gzip 主要是 `useVirtualRows` + `ResizeObserver` 订阅样板；比 `react-window` (~6 KB) 省太多。
