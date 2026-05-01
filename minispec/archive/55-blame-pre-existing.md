---
id: 55-blame-pre-existing
status: closed
---

# Why

Blame 页面把文件的所有行都归到首次 AI edit，即使只有几行被改动。用户看到全篇染色，无法区分哪些是 AI 改的、哪些是原文。根因：`propagateBlame` 在 `prior_blame === null` 时跳过 diff，直接把所有行归当前 edit。

# Approach

- Considered:
  - Option A: 用空字符串 sentinel（`edit_id: ''`）标记 pre-existing 行。简单，无需改 schema。
  - Option B: 让 `edit_id` 可为 null。需要改 schema + migration，UI 和 deleteSession 等多处都要处理 null。
- Chosen: Option A。空字符串不违反 NOT NULL 约束，UI 检查 `edit_id === ''` 即可。

# Scope

- In: `propagateBlame` 逻辑修复、API 响应加 `is_pre_existing` 标记、BlamePage UI 适配、测试更新
- Out: 历史数据回填、Bash sed 编辑追踪、schema migration

# Acceptance

- [ ] 文件首次被 AI 编辑时，只有实际变更的行归 AI edit，未变行显示为 pre-existing
- [ ] 全新文件（before_content === null）的所有行仍归当前 edit
- [ ] chain 断裂场景不受影响（before_lines 为空时仍全归当前 edit）
- [ ] BlamePage pre-existing 行显示灰色 bar、无 turn label
- [ ] 点击 pre-existing 行时 Inspector 显示 "Pre-existing content"，不显示 Revert 按钮
- [ ] 所有现有测试通过 + 新增测试覆盖

# Plan

- [ ] T1 Fix `propagateBlame` in `blame.ts`: diff when `prior_blame===null && before_lines.length>0`
- [ ] T2 Add `is_pre_existing` flag to `/api/blame` in `api.ts`
- [ ] T3 Update `BlamePage.tsx` to handle pre-existing lines
- [ ] T4 Update/add tests in `blame.test.ts`
- [ ] T5 Update spec docs

# Risks and Rollback

- Risk: 现有 DB 中已有的 blame 数据不会自动修复（需要新的 edit 才会重新计算）
- Rollback: revert propagateBlame 改动即可恢复旧行为
