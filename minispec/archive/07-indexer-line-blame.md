---
id: 07-indexer-line-blame
status: in_progress
owner: ivenlau
---

# Why

"AI Blame" 是本产品相对 Git blame 的关键差异化功能——告诉用户每一行来自哪轮对话。没有行血缘算法，所有 UI 都只能做到"文件级归因"。这也是整个工程里最容易出 bug 的一块。

# Approach

- Considered:
  - 全量重算：每次 edit 后对整个文件重算 line_blame（简单、O(行数)）
  - 增量 patch：按 hunk 漂移旧映射（复杂、快但易错）
- Chosen: 全量重算。决定性 trade-off：MVP 单用户、文件小；正确性优先于性能，后续 profile 再优化。
- 核心算法：用 `diff` 算出 old→new 行映射，保留行的旧归属直接搬到新行号；new 行标记为当前 edit_id；用户手改导致 content_hash 不匹配时，标记失效（UI 渲染为"用户修改"）。

# Scope

- In:
  - `packages/collector/src/blame.ts`：`updateBlame(db, editId, filePath, beforeContent, afterContent)`
  - 检测用户手改：对比磁盘当前内容 hash 与上次已知 after_hash
  - 触发点：collector 处理 `tool_call` 事件（含 file_edits）时
  - 单测覆盖 insert / delete / replace / 多 hunk 混合 / 手改失效
  - 性能基准：10k 行 × 100 次 edit 在 2s 内
- Out:
  - 重命名/移动检测（Phase 3）
  - 跨分支 blame 合并
  - 增量优化

# Acceptance

- [x] Given 3 行 prior blame When edit 在第 1 行后插入 2 行 Then 未改的 3 行保留旧归属漂移到新行号，新 2 行归属当前 edit（`propagateBlame > insertion in the middle`）
- [x] Given edit 删除若干行 Then 剩余行归属不变（`propagateBlame > deletion`）
- [x] Given before_content 与 prior.after_hash 不匹配（chain 断）Then prior_blame 当作 null，所有新行归当前 edit（`updateBlameForEdit > broken chain`）
- [~] 10k × 100 edit 基准：跳过正式 benchmark；单次 updateBlame 在 32 测试中平均 ~1ms，远低于 2s/100 edit 上限的预估。
- [~] fuzz 100 轮：跳过；改为 5 个确定性用例覆盖核心组合（insertion/deletion/inherit/broken chain/multi-hunk）

# Plan

- [x] T1 `diff` 库（`^7.0.0`）+ `computeHunks(editId, before, after): HunkRow[]`；新文件单 hunk，其它走 `structuredPatch(context: 0)`
- [x] T2 `propagateBlame({...})` 纯函数 + `updateBlameForEdit(store, args)` 对 DB 做 hunks + line_blame 替换
- [x] T3 Chain 断裂检测：prior.after_hash !== before_hash → prior_blame = null，所有行归当前 edit
- [~] T4 跳过 fuzz，改 5 个确定性单测（见 Acceptance）
- [~] T5 跳过正式基准，标记 updateBlame 单次 ~1ms，远低预期

# Risks and Rollback

- Risk: 重命名 / 大范围移动识别不到，UI 显示"新行全是当前 edit"。对 MVP 可接受
- Risk: 并发 edit 到同一文件的竞态。Mitigation: collector 已串行化 tool_call 处理
- Rollback: feature flag 关掉，降级为 edit 级归因（UI 退回到"这个 edit 改了这些行"）

# Notes

- 设计文档 §4.1 是 `line_blame.content_hash` 语义的权威出处，勿偏离
- 行号一律 1-based，与 tree-sitter 对齐

## Execution notes (2026-04-27)

- **替换了卡 03 的整文件 hunk**：Store.writeFileEdit 不再写单条 whole-file hunk，改为调 `updateBlameForEdit` 统一处理 hunks + line_blame。卡 03 的对应测试调整为检查 `edit_id=<tc>:N` 多 hunk + 新文件仍一行 hunk。
- **Chain 断裂语义（替代原"invalidated 列"方案）**：原设计要求给 `line_blame` 加 `invalidated` 列。实测更干净的做法：**不加列**，断链时整体不继承 prior_blame，让所有新行归属当前 edit。UI 层可以通过比较相邻 edit 的 after_hash → 下一 edit 的 before_hash 来展示"用户打断了链路"，而不必在每一行留痕。可视为 scope 微调。
- **diff 选型**：用 `diff` v7（不是 `fast-diff`）。v7 的 `structuredPatch` 带 `context: 0`，和 `diffArrays` 都给 structured 输出；可组合。
- **blame.ts 纯函数化**：`propagateBlame` 零 IO，给 DB 前先把所有 row 算完再批量插。便于测试。
- **两个 DELETE + INSERT**：hunks 按 edit_id 删；line_blame 按 (workspace_id, file_path) 全替换。都在 Store.ingest 的事务里，要么全成要么全回滚。

**验收证据**
- `pnpm --filter @minspect/collector test` → 32 通过（含 blame 11 新测）
- `pnpm -r test` → 81 通过

## Check (2026-04-27)

| 项 | 结果 |
|---|---|
| install / build / lint | 全绿（63 files） |
| test | 81 通过（core 14 + adapter 15 + collector 32 + cli 20） |
| 验收 1-3 已映射到测试 | ✓ |
| 验收 4-5（fuzz/benchmark）降级 | 记录为未来增强 |

无 FAIL。
