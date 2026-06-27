---
id: 20260627-add-start-command
status: closed
owner: claude
---

# Why

用户场景：daemon 在后台挂了（崩溃、被 kill、机器休眠唤醒失败）。当前的恢复路径都不顺手——`minspect serve` 在前台跑、关掉 terminal 就死；`minspect init` 重新跑 doctor + install hooks + autostart 配置，问题太多。需要一个轻量命令，**只**做 detach-spawn 后台 daemon，不动其他东西。

# Approach

- Considered:
  - Option A：复用 `init.ts` 末尾的 detach-spawn 块，抽出顶层 helper `runStartDaemonDetached(opts)`，standalone `start.ts` 包一个 CLI shim。
    - trade-off：代码复用最高；helper 增加 1 个 export，公开面略大。
  - Option B：把 detach-spawn 逻辑复制到 `start.ts`，独立维护。
    - trade-off：`init` 和 `start` 未来可能漂移（比如 5s timeout、spawnedBy 标签、openBrowser 行为）。
- Chosen: A。代码量小、测试 seam（findRunningDaemon / spawnServe / waitForDaemon / openBrowserFn）已经在那块，按 helper 形式抽出即可。

# Scope

- In:
  - `packages/cli/src/commands/init.ts`：把 `runInit` 末尾的 detach-spawn 块（detached daemon 启动 + 5s `/health` 轮询）抽出为顶层 `runStartDaemonDetached(StartDaemonOptions)` helper，返回 `StartDaemonResult { daemonStarted, port?, spawned, spawnFailed }`；`runInit` 末尾改调它。`spawnedBy` 由调用方决定——init 传 `'init'`，start 传 `'user'`。
  - `packages/cli/src/commands/start.ts`（新文件）：`runStart({ stateRoot?, ...testSeams })` 转发到 helper（强制 `spawnedBy: 'user'`、默认不开浏览器）。
  - `packages/cli/src/commands/start.test.ts`（新文件）：5 个 case — already-running、fresh-spawn、spawnFailed、timeout、不开浏览器（即使注入了 openBrowserFn）。
  - `packages/cli/src/bin.ts`：注册 `start` 子命令，`--open` flag 触发 `openBrowser`。
  - `minispec/specs/cli.md`：在命令清单加 `minspect start [--open]` 一行。

- Out:
  - 不动 doctor / install / autostart / config。
  - 不加 `--port` flag（要换端口用 `serve --port`）。
  - 不动 `init.ts` 的运行时行为（只是搬位置）。

# Acceptance

- [x] Given daemon 已跑，`minspect start`，When 命令完成，Then stdout `daemon already running on http://127.0.0.1:PORT (pid N)`，exit 0。
- [x] Given daemon 没跑，`minspect start`，When 命令完成，Then stdout `daemon: http://127.0.0.1:PORT (pid N)`，exit 0；daemon 实际在跑（`minspect status` 显示 running）。
- [x] Given `minspect start --open`，When 端口起来，Then 调用 `openBrowser`（Windows 上是 `cmd /c start <url>`）。
- [x] Given `start` 跑完，When 检查 `<state_dir>/config.json`，Then `autostart` 字段保持原值（不被改写）。
- [x] `pnpm -r test` 171/171 cli tests + 414/414 workspace tests pass；`pnpm -r build` 0 type error；biome clean。
- [x] `minspect --help` 输出包含 `start` 描述。
- [x] init 的 11 个现有测试不变（helper 抽取后行为等价）。

# Plan

- [x] T1 抽出 helper：init.ts 加 `runStartDaemonDetached`；`runInit` 末尾改调它。
- [x] T2 创建 `start.ts` + `start.test.ts`（5 case）。
- [x] T3 `bin.ts` 注册 `start`，`--open` flag。
- [x] T4 真机验证：fresh-spawn、already-running、--open、不动 config。
- [x] T5 更新 `minispec/specs/cli.md`。

# Risks and Rollback

- Risk：`runStartDaemonDetached` 多了一个 export 后，未来如果别的 caller 改了 helper 默认行为，`init` 跟着变。
  - 缓解：helper 的所有可选 test seam 都有显式默认值；公开面 + 1 个 type export，不暴露任何状态。`init` 的现有 11 个测试覆盖了三条主要路径（already-running、fresh-spawn、timeout），如果未来 helper 改了行为会立刻挂掉。
- Risk：`start` 和 `init` 在用户认知里可能重叠（"我想重新 setup 该用哪个？"）。
  - 缓解：`start` 的 description 明确写 "no hooks, no autostart, no UI"；`init` 的 description 是 "One-shot setup"。help 文本里两行紧挨着，差异一眼看出。
- Rollback：`start` 是纯 additive——删 `bin.ts` 里的注册 + 删 `start.ts` / `start.test.ts` + 从 init.ts 删 helper export + 把 init.ts 末尾 inline 回来。`init.ts` 改动可完全 revert，因为 helper 是从 inline 代码原样搬出来的。

# Notes

- `start` 默认不开浏览器；想看的用户加 `--open`。这跟 `serve`（默认开）不一样，但 `start` 的语义是"恢复后台任务"，不是"启动并演示"，所以默认不开符合预期。
- `spawnedBy: 'user'` 让 status 输出能区分"用户手动 start 起来" vs "init 启动"——之前 init 用 `'init'`，现在 start 用 `'user'`。
- 测试 seam（`findRunningDaemon` / `spawnServe` / `waitForDaemon` / `openBrowserFn`）跟 init 一样注入，不需要 mock `child_process`——`start` 自身不调 OS 命令。
