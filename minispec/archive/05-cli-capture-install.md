---
id: 05-cli-capture-install
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: cli
---

# Why

Adapter 是纯函数，需要 CLI 入口把 hook 的 stdin 读进来、调 adapter、POST 给 collector。另外用户需要"一键配置"——手动编辑 `settings.json` 门槛太高、易出错。

# Approach

- `minspect capture --event <type>`：stdin JSON → session 状态 → adapter.parse → git 富化 → POST（失败落盘队列）。
- `minspect install --agent <name>`：解析对应 agent 的配置文件，merge 注入 hook 块，备份原文件。

# Scope

- In: `paths.ts` / `session-state.ts` / `queue.ts` / `transport.ts` / `commands/capture.ts` / `commands/install.ts` / `bin.ts`；13 个单测。
- Out: `serve`（卡 10）；其它 agent install；post-commit hook（卡 06）；卸载命令；正式 p95 基准。

# Acceptance

- [x] 在线 POST 入库；离线落队列并 <500ms 退出；队列在下次 capture drain。
- [x] install 注入 5 种 hook、备份 `.bak.<ts>`、幂等、保留用户自有 hook、malformed 拒写。
- [x] hook 链路 p95 粗验 <150ms（capture.test.ts 5 次合成 payload + stub collector 总耗时 ~580ms）。

# Plan

- [x] T1 capture：stdin → adapter → POST
- [x] T2 磁盘队列
- [x] T3 install --agent claude-code：merge + 备份
- [x] T4 粗 p95 观察

# Risks and Rollback

- Risk: 损坏用户 settings.json。Mitigation: malformed → 抛错拒写；写前 `.bak.<ts>`。
- Risk: 队列目录爆炸。Mitigation: 后续卡补配额、TTL。
- Rollback: 手动从 `.bak.<ts>` 恢复；删 `<state_dir>/` 清队列 + 会话状态。

# Notes

- hook 命令在 Windows 用 `minspect.exe` 绝对路径，不依赖 PATH。
- 工具 matcher 遵从 Claude Code 规范（`Edit|Write|MultiEdit|Bash`）。

## Execution notes (2026-04-27)

- 依赖：cli → `core` / `adapter-claude-code` / `commander ^12.1.0`。
- **每会话状态文件**：`<state_dir>/sessions/<session_id>.json`，载 turn_idx / current_turn_id / tool_call_idx / pretool_before。
- **Pre/Post 配对**：Pre 存 before、Post 读 after 组装 file_edits 并清 pretool_before[file_path]。
- **Stop 调 `extractReasoning`**：回填 turn_end.agent_reasoning / agent_final_message。
- **Install marker**：hook 内 `__minspect_managed__: true`；重跑先 strip 我方再插入，idempotent。
- **Transport**：原生 fetch + 500ms AbortController；失败 → `<state_dir>/queue/<ts>-<uuid>.json`；下次 drain 再发新事件。
- **Capture 容错**：任何异常 → stderr + `process.exit(0)`，绝不阻塞 agent。
- **bin** → `dist/bin.js`（shebang + commander）。

## Check (2026-04-27)

- install / build / test / lint 全绿；58 tests 通过。
- 全量并行测试偶发 `core/git.test.ts` flaky（Windows 并发 git 敏感），单包稳。

## Close (2026-04-27)

- 新建 `minispec/specs/cli.md`（CLI domain）。
- README 登记 cli.md。
- 卡状态 closed，归档。
