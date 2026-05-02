---
id: 36-diff-hunk-nav
status: draft
owner: ivenlau
---

# Why

CompareModal 打开后，用户只能手动滚动找变更处。文件大时变更分散，肉眼扫描低效。加 prev/next 导航按钮 + 快捷键，自动跳到上一个/下一个 diff hunk，同时高亮当前 hunk 行。

# Approach

- 从 `buildSideBySide` 的结果中提取变更行索引（`left[i].type !== 'unchanged' || right[i].type !== 'unchanged'`），相邻变更行合并为一个 hunk group。
- 维护 `activeHunk` state（group index），prev/next 按钮 + `Shift+ArrowUp` / `Shift+ArrowDown` 快捷键循环切换。
- 滚动目标：对 `.body` 容器调用 `scrollIntoView` on the first line element of the active hunk group。
- 高亮：active hunk 行加 `.lineActive` CSS（`var(--accent)` 低透明度背景）。
- Header 区域插入 `◀ ▶` nav 按钮 + "3 / 12" hunk 计数器。

# Scope

- In:
  - `CompareModal.tsx`：hunk group 提取、activeHunk state、nav buttons、keyboard handler、scrollIntoView、高亮渲染
  - `CompareModal.module.css`：`.lineActive`、`.navBtn`、`.navCounter` 样式
  - `strings.ts`：`blame.diffNav` / `blame.diffNavPrev` / `blame.diffNavNext`（EN + ZH）
- Out:
  - 行级 word-diff 高亮（只做 hunk 级跳转）
  - 跨 pane 独立滚动（当前共享 `.body` 滚动容器已满足需求）

# Acceptance

- [ ] 打开 CompareModal → header 显示 nav 按钮 + "1 / N" 计数器（N 为 hunk group 数）
- [ ] 点 ▶ 或按 `Shift+ArrowDown` → 跳到下一个 hunk，计数器更新，对应行高亮
- [ ] 点 ◀ 或按 `Shift+ArrowUp` → 跳到上一个 hunk
- [ ] 到达末尾后 ▶ wrap 回第一个；到达开头后 ◀ wrap 到最后一个
- [ ] 无变更行时（identical files）nav 不显示
- [ ] Escape 仍正常关闭 modal
- [ ] 测试全绿（ui 65+）

# Plan

- [ ] T1 `CompareModal.tsx`：提取 hunk groups + activeHunk state + nav buttons + keyboard handler + scrollIntoView + 高亮
- [ ] T2 `CompareModal.module.css`：`.lineActive` / `.navBtn` / `.navCounter`
- [ ] T3 `strings.ts`：新增 3 个 i18n key（EN + ZH）
- [ ] T4 测试验证

# Risks and Rollback

- Risk: scrollIntoView 在 flex 容器内可能不准。Mitigation: 对 `.body` 容器用 `scrollTo` + `offsetTop` 手动计算。
- Rollback: 删 nav 相关代码和 CSS，恢复原 header。

# Notes

- 快捷键选择 `Shift+ArrowDown/Up`：不与 Escape 冲突，不与浏览器默认行为冲突，语义明确。
- hunk group 合并逻辑：连续的非 unchanged 行归为一组，组间至少隔一行 unchanged 才拆分。
