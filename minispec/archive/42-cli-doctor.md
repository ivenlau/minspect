---
id: 20260429-cli-doctor
status: closed
owner: ivenlau
---

# Why

出问题时（hook 没装 / daemon 没起 / 事件没到 / DB 不可写 / git hook 缺）用
户不知从何查起。需要一条命令一次过所有检查，给出绿/黄/红 + 修复建议，并支
持 `--json` 让 UI 和脚本复用同一组诊断。卡 44 `minspect init` 也会复用这套
检测。

# Approach

- Considered:
  - 只做 CLI。
  - 只做 UI 页。
  - 共享同一诊断引擎，CLI + UI 都消费（`--json` 或 HTTP 端点）。
- Chosen: CLI 先落地，`--json` 输出；UI 侧后续卡再接 `/api/doctor`，本卡不
  引入新 HTTP 端点。

# Scope

- In: `packages/cli/src/commands/doctor.ts`，检查项：
  1. Node ≥ 20
  2. state dir 可写（`paths.ts::stateDir()`）
  3. `daemon.json` 存在 + 端口 listening + `/health` 200
  4. `~/.claude/settings.json` 含 managed hook block
  5. 当前目录是否 git 仓；如是，`.git/hooks/post-commit` 是 minspect 写的
  6. `<state_dir>/history.sqlite` 可打开 + schema version 符合当前
     `INITIAL_SCHEMA` 预期
  7. 最近 5 min 是否收到 event（`/api/queue-stats` + DB `SELECT max(recv_at) FROM events`）
  - 输出：行内 ✓/⚠/✗ + 短修复建议。
  - `--json`：`{checks: [{id, status, message, fix?}], summary: {...}}`。
  - 退出码：✗ 存在 → 1，否则 0。
- Out: 写修复动作（只读）；跨用户扫描。

# Acceptance

- [ ] Given 干净机器, When `minspect doctor`, Then 打印 "hook: ✗ not
      installed · fix: run `minspect init`"；退出码 1。
- [ ] Given hook 装了但 daemon 未起, When doctor, Then "daemon: ✗ not
      running · fix: `minspect serve`"。
- [ ] Given daemon 跑但最近 5 min 无事件, When doctor, Then
      "events: ⚠ no events in last 5m · fix: confirm the agent is running"。
- [ ] Given `--json`, Then stdout 是合法 JSON，无任何彩色输出。
- [ ] Given 全绿, Then 退出码 0。

# Plan

- [ ] T1 `doctor.ts`：每项检查拆 async function 返回 `{id, status, message, fix?}`。
- [ ] T2 `bin.ts` 加 command `doctor --json`。
- [ ] T3 `doctor.test.ts`：mock state dir / daemon.json 的几种组合。
- [ ] T4 README 增加 "If things go wrong → `minspect doctor`" 章节。
- [ ] T5 `minispec/specs/cli.md` 记录退出码与 JSON schema。

# Risks and Rollback

- Risk: 跨平台路径差异（LOCALAPPDATA vs XDG）。缓解：全程走 `paths.ts`。
- Risk: `/health` 超时导致整个 doctor 卡住。缓解：每项 1s timeout。
- Rollback: 删命令。

# Notes

- schema version 检查用现有 `PRAGMA user_version` 读法（core 已有 helper）。
- 44 卡 init 和 UI 系统健康横幅都会复用这个 JSON shape。
