---
id: 50-fix-multi-browser-open
status: closed
owner: ivenlau
depends_on: [43-cli-auto-spawn-daemon, 44-cli-init, 48-init-detach-daemon]
---

# Why

`minspect init` 交互式选了"Import 30d Codex sessions"后，浏览器被打开
数十次。Codex 单 session 有几百个 event，`sendEvent` 每个 event 在
daemon 还没起来时都调 `maybeSpawnDaemon()`（`auto_spawn_daemon: true`），
没有去重；几十个 `serve --quiet` 进程 race 着启，第一个抢到 21477 后，
剩下的进 `runServe` 复用路径 —— 然后复用路径的浏览器打开没看
`options.quiet`，只看 `options.noOpen`。每个失败者都当场弹浏览器。

# Approach

- Considered (fix 1):
  - A. 复用路径加 `&& !options.quiet` 检查，对齐新启路径的语义。
    一行改动，根治症状。
  - B. 让 detach-spawn 传 `--no-open`：治标，但 `--quiet` 语义
    "不 noisy / 不 open browser" 本来就该成立，A 更正交。
- Chosen (fix 1): **A**。
- Considered (fix 2 — spawn 去重):
  - C. 模块级 boolean 锁 `spawnedOnce`：最简单，但 daemon 死后
    本进程再也不会 respawn。
  - D. 时间窗口冷却 `lastSpawnAt` + 5s TTL：一个进程里 5s 内最多
    spawn 一次；daemon 死后 5s 可以再起。
  - E. 文件级 sentinel（`<state_dir>/.spawning`）：跨进程去重，
    但 stale lock 处理复杂。
- Chosen (fix 2): **D**。跨进程的 spawn 靠 OS 端口竞争自然兜底
  （只有一个能 bind 21477），单进程 D 已经够。

# Scope

- In:
  - `packages/cli/src/commands/serve.ts`：
    - reuse 路径的 `if (!options.noOpen) void openBrowser(...)`
      改成 `if (!options.noOpen && !options.quiet) ...`，与新启
      路径的 `shouldOpen` 对齐。
    - 顺手把 `openBrowser` 的调用改成可注入（`options.openBrowser`
      测试 seam），方便单测直接 spy。
  - `packages/cli/src/transport.ts`：
    - 模块级 `let lastSpawnAt = 0;` + 5s 冷却窗口。
    - 导出 `__resetMaybeSpawnDedupeForTest()` 给单测 beforeEach 用。
  - `packages/cli/src/commands/serve.test.ts`：新增用例 ——
    已有 daemon 时 `runServe({quiet: true})` 不打开浏览器。
  - `packages/cli/src/auto-spawn.test.ts`：新增用例 ——
    连续 5 次 `sendEvent` 无 target + `auto_spawn_daemon: true`
    时 spawn 只发生 1 次。
  - `packages/cli/package.json` 版本 0.1.1 → 0.1.2。
- Out:
  - 不改 hook capture 路径本身的 event 流。
  - 不做 `<state_dir>/.spawning` 文件级跨进程 lock（当前单进程
    去重 + OS 端口竞争足够，引入文件 lock 得额外考虑 stale 清理）。
  - 不改 `auto_spawn_daemon` 默认值 / 交互问法。

# Acceptance

- [ ] Given `auto_spawn_daemon: true` + init 选 import Codex 30d,
      When codex import 运行, Then 浏览器在整个 init 期间最多被打开
      1 次（最后 init 自己那一次）。
- [ ] Given 已有 daemon 在跑, When detach-spawn 的 `serve --quiet`
      进程跑到 reuse 路径, Then 它不调用 `openBrowser`。
- [ ] Given `auto_spawn_daemon: true` + `sendEvent` 连续 5 次无
      target, Then 底层 `spawn` 只被调用 1 次（同一进程、5s 冷却内）。
- [ ] Given daemon 死亡超过 5s 后再次 `sendEvent`, Then `spawn`
      可以被再次调用（不被 cooldown 永久锁死）。
- [ ] `pnpm -C packages/cli vitest run` 全绿；现有 serve / auto-spawn
      / init 测试保持通过。

# Plan

- [ ] T1 `serve.ts` reuse 路径加 quiet 检查 + `ServeOptions.openBrowser`
      测试 seam（默认指向模块里的 `openBrowser`）。
- [ ] T2 `transport.ts` 加 `lastSpawnAt` 冷却窗口 + `__reset...ForTest`。
- [ ] T3 `serve.test.ts` 加"quiet 模式复用不开浏览器"用例；
      `auto-spawn.test.ts` 加"连续 5 次只 spawn 1 次" + "冷却到期
      可再 spawn"用例。
- [ ] T4 `packages/cli/package.json` 0.1.1 → 0.1.2。
- [ ] T5 `specs/cli.md` Canonical rules 加一条："`serve --quiet`
      不 open browser，包括 reuse 路径" + "`maybeSpawnDaemon` 有 5s
      冷却窗口，防 spawn storm"。

# Risks and Rollback

- Risk: 冷却窗口设小了还是起不来（比如低配机器 daemon 启动 >5s）。
  缓解：window 选 5s 基于 `spawnServeDetached` + `startServer` fastify
  listen 经验 <1s；超了也只是等下一次 event。
- Risk: 测试里的 `__resetMaybeSpawnDedupeForTest` 被生产代码误用。
  缓解：名字带 `ForTest` + JSDoc `@internal`；biome 不 flag 但
  code review 能抓。
- Rollback: 两处改动独立。单独 revert serve.ts 那行就能回滚 fix 1；
  transport.ts 改动全 revert 就回滚 fix 2。

# Notes

- 本卡与 0.1.2 发布一起落地。0.1.1 刚发，用户马上遇到，修得越快越好。
