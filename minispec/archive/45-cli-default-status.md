---
id: 20260429-cli-default-status
status: closed
owner: ivenlau
---

# Why

`minspect` 无参时打印帮助页。新用户最常见的诉求其实是"这东西现在装没装、
跑没跑、UI 在哪"。把无参行为改成 `minspect status`，装上后敲 `minspect` 直
接就能看到 daemon 状态 + UI URL + 最近活动。

# Approach

- Considered:
  - 无参 → `serve`：会实际起进程，副作用太大。
  - 无参 → `init`（未初始化时）/ `status`（已初始化时）：状态相关逻辑分
    散；用户意图不总是"再装一次"。
  - 无参 → `status`：纯只读；若检测未初始化则在输出里提示跑 `minspect init`。
- Chosen: 无参 → `status`。新增 status 命令本身轻量；帮助页仍通过
  `--help` / `-h` 可达。

# Scope

- In:
  - `packages/cli/src/commands/status.ts`：查 daemon.json + `/health` +
    `/api/queue-stats` + "最近 event 时间"；打印
    ```
    daemon:   running on http://127.0.0.1:21477  (spawned_by: user, pid 12345)
    queue:    0  poisoned: 0
    last:     event 3m ago
    hooks:    claude-code ✓   opencode ✗
    ```
    未 init 时顶部提示 `minspect init`。
  - `bin.ts` default action = `status`。
  - `status --json` 机器可读。
- Out: 新增功能；status 只复用 daemon.json 和现有 API。

# Acceptance

- [ ] Given 未装过, When `minspect`, Then 打印"not initialized · run
      `minspect init`" + 退出码 0。
- [ ] Given daemon 跑, When `minspect`, Then 打印 port / spawned_by /
      queue / 最近 event / hook 装状态。
- [ ] Given daemon 未跑但 daemon.json 存在, Then 打印 "daemon: stopped"
      并提示 `minspect serve`。
- [ ] Given `minspect --help`, Then 帮助页原样输出。
- [ ] Given `minspect status --json`, Then 合法 JSON 无 ANSI 色码。

# Plan

- [ ] T1 `status.ts`：读 daemon.json + `fetch('/health')` + `/api/queue-stats`；
      hook 状态复用卡 42 的 agent 检测。
- [ ] T2 `bin.ts` 设 `program.action(() => runStatus())`（无子命令时触发）。
- [ ] T3 `status.test.ts`：daemon 跑 / 未跑 / 未初始化 / `--json` 四种。
- [ ] T4 README / cli.md 更新。

# Risks and Rollback

- Risk: 有人脚本依赖 `minspect`（无参）输出帮助。概率极低；`--help`
  仍是正统入口；在 release note 说明。
- Rollback: bin.ts 去 default action，恢复帮助页。

# Notes

- status 的 `hooks:` 行复用卡 42 doctor 的检测函数。
