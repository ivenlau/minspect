---
id: 20260429-cli-uninstall
status: closed
owner: ivenlau
---

# Why

当前卸载流程是"手改 `~/.claude/settings.json`，找 `__minspect_managed__: true`
的 block 删掉"——文档教学级体验，非技术用户不接受。`install` 已经写了
guard，卸载完全可以机器自动。缺命令是对称性缺陷。

# Approach

- Considered:
  - 只做 `--agent X`：精准撤单个 agent 的 hook。
  - 加 `--all` / `--purge`：一键撤所有 agent + 可选清 state。
- Chosen: 两者都做。默认 dry-run；`--yes` 才真写；`--purge` 需 `--yes` 且
  再次确认（state 删除不可逆）。backup 文件复用 install 的命名规则。

# Scope

- In: `packages/cli/src/commands/uninstall.ts`；CLI 参数 `--agent <name>` /
  `--all` / `--purge` / `--yes`；复用 install 的 managed-block 读写工具；
  打印"将移除的文件与键"dry-run 清单；`--purge` 清 `<state_dir>/history.sqlite`
  + `sessions/` + `queue/`。
- Out: post-commit 之外的 git hook；删 `.claude/` 目录；跨用户清理。

# Acceptance

- [ ] Given hook 已装, When `minspect uninstall --agent claude-code --yes`, Then
      只移除 `__minspect_managed__: true` 的 entry，其它 user hook 原样保留，
      写 `.backup.<ts>`。
- [ ] Given 无 managed block, When 重复 uninstall, Then 打印 "no minspect
      hooks found"，退出码 0。
- [ ] Given `--all --yes`, When 装过 claude-code + opencode, Then 两者都撤，
      stop daemon。state 不动。
- [ ] Given `--all --purge --yes`, Then 上述 + 删 `<state_dir>/history.sqlite`
      + sessions/queue 子目录。
- [ ] Given 无 `--yes`, Then dry-run 打印计划不写任何文件。

# Plan

- [ ] T1 从 `install.ts` 抽公共 util：`readManagedBlock(path)` /
      `writeWithoutManagedBlock(path, backupTs)`。
- [ ] T2 `runUninstall({ agent, all, purge, yes, dryRun })` 实现；复用
      `install-opencode.ts` 的 plugin 撤销逻辑（JS 文件整段删）。
- [ ] T3 `bin.ts` 新 command `uninstall`。
- [ ] T4 `uninstall.test.ts` 覆盖：单 agent 撤、all、purge、dry-run、重复
      idempotent、用户自定义 hook 不被误删。
- [ ] T5 README `Uninstall` 章节重写。

# Risks and Rollback

- Risk: 用户在 managed block 里加了自定义 key → 撤销会丢。缓解：撤之前
  diff 打印"这些 key 不是 `__minspect_managed__: true` 写进去的"warning，
  要 `--force-unknown` 才继续。
- Rollback: backup 文件存在，`mv .backup.<ts> <original>` 复原。

# Notes

- `install-opencode` 的卸载是删整个 `plugin/minspect.js` 文件，不存在 key 合
  并问题。
