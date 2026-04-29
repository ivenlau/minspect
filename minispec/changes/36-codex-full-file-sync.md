---
id: 36-codex-full-file-sync
status: draft
owner: ivenlau
depends_on: [19-adapter-codex-real-parser]
---

# Why

Codex `apply_patch` log 只带 hunk 窗口，所以：
- Blame 行号相对 hunk 窗口，不是绝对文件坐标
- Revert 整个被硬 block（怕覆盖未记录区域）

对认真用 Codex 的用户这两件事都挺限制。如果 import 时能读一次磁盘拿全文 snapshot，可以解锁。

# Approach

`minspect import-codex` 加 `--sync-workspace <path>` flag。对每个 `apply_patch` edit，读当前磁盘文件全文作为 "after_content"，用 reverse-apply patch 生成 "before_content"。

限制：
1. 要求用户提供 workspace 路径 + 该 workspace 从 import 时刻起没被改过（否则 synthesized before_content 错误）
2. 仅能给**最后一个** edit 全文；更早的 edit 还是 hunk-relative（因为只知道最终磁盘状态）

# Scope

- In:
  - `packages/adapters/codex/src/parse.ts`：parse 输出时保留原 hunks（已有）
  - `packages/cli/src/commands/import-codex.ts`：加 `--sync-workspace <path>` 选项 + 可选的"仅最后一 edit 有全文"模式
  - 逻辑：parse 得到 edits → 对每个 file 找最后一个 edit → 读磁盘全文 → 用 diff.reversePatch 反向生成 before_content
  - Store：把 "is_synthesized_hunk" flag 传到 edits 表（新列，migration 幂等）
  - UI：Blame 页头部如果文件 edit 的全文 synth 不完整 → 显示 "Codex session (blame relative to hunk window)" 灰色提示
  - Revert：如果 target edit 是 **最后一个** + 有 full file → 允许（解硬锁）；否则维持硬锁
  - 测试：sync 成功 / 磁盘文件缺失 / 反向 apply 失败
- Out:
  - 自动检测 workspace 在 import 时刻是否被改（不可能，是信任输入）
  - 所有 edit 全文重建（算力不可得）

# Acceptance

- [ ] `minspect import-codex --session <s> --sync-workspace <path>` 读磁盘补全最后一个 edit 的 file_path
- [ ] DB `edits` 新列 `is_full_file` 填对
- [ ] UI Blame 页在有 full file 的场景下行号是绝对的
- [ ] Revert 在 "最后一个 edit + full file" 场景下工作；其它场景继续硬锁
- [ ] 测试覆盖 3 场景

# Plan

- [ ] T1 migration 加 `edits.is_full_file BOOLEAN DEFAULT 0`
- [ ] T2 CLI `--sync-workspace` 逻辑 + diff.reversePatch 使用
- [ ] T3 Revert plan 基于 is_full_file 解锁逻辑
- [ ] T4 UI 提示条
- [ ] T5 tests + specs
- [ ] T6 close

# Risks and Rollback

- Risk: reversePatch 失败率。Mitigation: 失败时回退为 hunk-window 行为，不抛错。
- Risk: 用户错误地指向已 commit 后改过的 workspace → 错误 before_content。Mitigation: import 时 SHA256 验证当前磁盘文件 hash == 最新 Codex edit.after patch 预期。不匹配则跳过该文件。
- Rollback: 删 `--sync-workspace` 和新列（保留老字段）。

# Notes

- 低优先级：等有 Codex 活跃用户反馈再做。
