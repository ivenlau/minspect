---
id: 48-init-detach-daemon
status: closed
owner: ivenlau
depends_on: [44-cli-init, 43-cli-auto-spawn-daemon]
---

# Why

`minspect init` 当前在同一个进程里 `await runServe(...)`，导致 daemon 与执行
init 的终端绑死 —— 关窗口 = HTTP 守护进程被杀，UI 立刻不可达。这跟大多数
CLI（`colima start`、`ollama serve`、`docker desktop`）用户心智不一致。
虽然 `auto_spawn_daemon: true` + 下次 hook 触发能复活，但中间有空档，且
init 完成后 UI 就开着的体验被破坏。

# Approach

- Considered:
  - A. 维持现状 + 在 init 末尾提示"请保持此窗口开启"：最小改动，零风险，
    但不解决问题，也与 `auto_spawn` 的 detach 路径存在心智重复。
  - B. init 末尾 detach-spawn `minspect serve --quiet`（复用 transport.ts
    里 hook 已验证的 `spawn(node, bin, serve, --quiet, {detached, stdio:
    ignore, windowsHide, unref()})` 模式），然后轮询 `/health` 确认起来，
    open browser，init 退出。
- Chosen: **B**。detach 模式已有一条生产路径（hook auto-spawn）在跑，把它
  抽到共享 helper 一处实现；init 调用方只负责 pre-check + 健康轮询 +
  打印 + 打开浏览器。hook 走同一个 helper，消除两处重复。

# Scope

- In:
  - `packages/cli/src/commands/serve.ts`：导出 `spawnServeDetached({stateRoot?})`
    helper。参数封装 `detached+stdio:ignore+windowsHide+unref+env
    MINSPECT_SPAWNED_BY`，返回 child pid。`transport.ts::maybeSpawnDaemon`
    改为调它，消除重复 spawn 代码。
  - `packages/cli/src/commands/serve.ts`：导出 `waitForDaemonReady({port?,
    stateRoot?, timeoutMs})` —— 轮询 state.json 取 port + `/health`；超时
    返回 null。
  - `packages/cli/src/commands/init.ts`：最后一步从 `await runServe(...)`
    改为：
    1. `findRunningDaemon()` 若已在跑 → 打印 "daemon already running on
       :PORT"，open browser，返回。
    2. 否则 `spawnServeDetached({spawnedBy: 'init'})`，`waitForDaemonReady`
       最多 ~5s。
    3. 起来 → 打印 "daemon: http://... (pid N)" + open browser；超时
       → 打印 "daemon did not come up in 5s — run 'minspect serve' manually"，
       但 init 仍 exit 0。
  - 新 test hook：`InitOptions.spawnServe?: () => Promise<{port, pid} | null>`
    供测试注入；默认走 `spawnServeDetached` + `waitForDaemonReady`。
- Out:
  - 不碰 `auto_spawn_daemon` 的语义 / prompt。
  - 不改 `minspect serve`（前台）命令本身的行为 —— 用户直接跑 `serve`
    时仍然是前台绑终端。只有 `init` 的"启动一次"路径变成后台。
  - Windows 下的 `Start-Process -WindowStyle Hidden` 方案不采纳；
    `windowsHide: true` 的 Node 原生 spawn 对 CLI 场景够用。

# Acceptance

- [ ] Given 干净机器 + 无 daemon 运行, When `minspect init --yes`, Then
      init 进程退出后 daemon 仍在跑（`curl 127.0.0.1:21477/health` = 200），
      关闭执行 init 的终端不影响 daemon。
- [ ] Given daemon 已在 21477 跑, When `minspect init`, Then 不 spawn 新
      进程（通过 pid 对比可验证），打印 "already running"，打开浏览器。
- [ ] Given spawn 后 5s 内 `/health` 仍不通, When init 结束, Then exit 0，
      打印明确的"未起来 + 建议 `minspect serve`"文字，不卡住也不崩溃。
- [ ] Given `--yes --no-open` 或无 DISPLAY 环境, Then 不尝试开浏览器，
      其它流程不受影响。
- [ ] `pnpm -C packages/cli test` 全绿；现有 init.test.ts 6 个用例保持
      通过（通过 `spawnServe` 注入桩或 `skipServe` 保留行为）。

# Plan

- [ ] T1 `serve.ts` 新增 `spawnServeDetached` + `waitForDaemonReady`
      exports，现有 `transport.ts::maybeSpawnDaemon` 改为复用。
  - Expected output: `transport.ts` spawn 代码行数下降；新函数有 JSDoc。
- [ ] T2 `init.ts` 替换末尾的 `runServe` 调用；新增 `spawnServe` 测试注入点；
      失败路径打印 + exit 0。
  - Expected output: init 跑完不再阻塞；关终端 daemon 存活。
- [ ] T3 新测试 `init.test.ts`：
      - `spawnServe` stub 返回 `{port: 21477, pid: 99999}` → 断言返回 port。
      - stub 返回 null → 断言 daemonStarted=false 且不抛。
      - 已有 daemon 路径（stub `isDaemonAlreadyRunning` 返回 true）→ 断言
        `spawnServe` 未被调用。
  - Expected output: 3 新用例 + 6 旧用例全绿。
- [ ] T4 `specs/cli.md`：更新 `minspect init` 描述为"detach-spawn 后台
      daemon，init 本身退出"；并在 "Canonical rules" 加一条"init 起 daemon
      走 detach-spawn，关终端不影响 daemon"。
  - Expected output: spec 与行为一致；README 的 `minspect init` 段无需改
     （外部语义不变，只是进程生命周期变）。

# Risks and Rollback

- Risk: Windows 某些 shell（git-bash）对 `windowsHide` 支持不一致，可能
  仍弹一瞬间黑窗。缓解：透传 `windowsHide: true`（已在 transport.ts 验证
  可用），若仍有问题用 `spawn` 的 `shell: false` + 绝对路径避免 cmd.exe
  包装。
- Risk: detach 的 child 若启动失败（端口被占、DB 锁），init 看不到 stderr。
  缓解：`waitForDaemonReady` 超时后建议用户手动跑 `minspect serve` 拿到
  真实错误。
- Rollback: revert init.ts 那一步回到 `await runServe(...)`；serve.ts 新
  exports 即使留着也无害（hook 路径会继续受益）。

# Notes

- 与 `auto_spawn_daemon` 的关系：该 flag 控制"hook 要不要主动起 daemon"，
  本卡只改 init 自己的启动方式，不改 flag 语义。用户即便选 `auto_spawn:
  false`，init 后 daemon 仍在跑（init 明确要起）。
