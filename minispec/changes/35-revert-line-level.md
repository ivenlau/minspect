---
id: 35-revert-line-level
status: draft
owner: ivenlau
depends_on: [21-cli-revert]
---

# Why

当前 revert 最细到 edit（一次 tool_call 的一个文件）。用户真实场景："AI 改了 20 行，其中 3 行是 bug 我想撤，17 行保留"—— 需要 hunk / 行级。

这是硬问题：需要三路合并，可能产生冲突。本卡只解最小可用版本。

# Approach

新 revert 目标 `--hunk <hunk_id>`。流程：
1. 读 hunk 的 before/after + 当前文件内容
2. 尝试反向 apply：用 `diff.applyPatch` 生成的 reverse 打回当前文件
3. 如果失败（行号对不齐）→ 返回三路冲突，不写盘
4. 成功 → 写磁盘

UI：blame 页 hunk 级 revert 按钮 + 冲突可视化。

# Scope

- In:
  - `packages/collector/src/api.ts`：扩展 `/api/revert/plan` 支持 `hunk=<hunk_id>`，返回 merge preview
  - 新依赖：依赖 `diff.applyPatch` from `diff` package
  - `packages/cli/src/commands/revert.ts`：加 `--hunk <id>` 选项
  - UI BlamePage 的 hunk 级 revert 按钮（选中行时 inspector 里显示该 hunk 的 "Revert this hunk" 按钮）
  - 冲突 dialog：展示 before / current / proposed 三列
  - 测试：3 个合成场景 + 冲突场景
- Out:
  - 交互式冲突解决（把冲突塞进文件当作 git merge markers —— 最简做法，先这样；后续 UI 改进）
  - 跨 hunk 批量 revert
  - 自动 rebase 后续 edits —— 不做，后续 edits 仍然保留在 blame 记录里

# Acceptance

- [ ] `minspect revert --hunk <id>` 在可干净合并时成功写盘
- [ ] 冲突时返回 `{conflicts: [...]}` 带 markers，不写盘
- [ ] UI 点 "Revert this hunk" → 预览 → 应用 or 取消
- [ ] 测试覆盖干净合并 + 冲突两条路径

# Plan

- [ ] T1 三路合并工具（`packages/core/src/revert-hunk.ts`），纯函数 + test
- [ ] T2 extend `/api/revert/plan`
- [ ] T3 CLI `--hunk`
- [ ] T4 UI 按钮 + 冲突 dialog
- [ ] T5 close

# Risks and Rollback

- Risk: merge 逻辑写错误伤数据。Mitigation: 纯函数 + 大量单测 + dry-run 是默认 + 磁盘 sha256 drift 检查。
- Risk: diff 库版本 bug。Mitigation: pin 住版本 + ship with conservative merge rules（任何不确定都算冲突）。
- Rollback: 关掉命令 + 移除 UI 按钮；其它 revert 模式不受影响。

# Notes

- 这是最大风险卡，建议放最后做；先观察 34 落地一段时间。
