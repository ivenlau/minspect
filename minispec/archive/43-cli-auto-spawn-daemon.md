---
id: 20260429-cli-auto-spawn-daemon
status: closed
owner: ivenlau
---

# Why

装完 hook 用户自然期望"开聊就能看数据"。当前必须先 `minspect serve`，忘了
的话事件进 disk-queue，UI 看不到，直到下次手工 serve + drain。要用"hook 自
拉 daemon"兜底这个空窗期，但必须是用户知情开启——后台进程悄悄运行会让用
户反感。

# Approach

- Considered:
  - 默认开启 auto_spawn：安装即用，弊是"不知情后台进程"。
  - 不做 auto_spawn：体验没改善。
  - 默认关闭 + init 首次问一次开启（写进 config.json）+ UI 显示 daemon 的
    `spawned_by` 字段，让用户随时知道是谁起的。
- Chosen: 默认关闭 + init 问一次（见卡 44）。本卡只做底层：config 读写、
  hook detached spawn、daemon.json spawned_by 字段。

# Scope

- In:
  - `packages/cli/src/paths.ts`：`readConfig()/writeConfig()`，config 路径
    `<state_dir>/config.json`，当前仅一个 key `auto_spawn_daemon: boolean`。
  - `capture.ts` / `capture-opencode.ts`：探测 daemon 不可达 → 读 config →
    `auto_spawn_daemon: true` 则 detached spawn `node bin.js serve --quiet`；
    不等 daemon ready，立即走 disk-queue 正常路径保持 ≤100ms SLA。
  - `serve.ts`：新 `--quiet` flag（不打印 banner、不 open browser）。
  - `daemon.json`：新字段 `spawned_by: 'user' | 'hook' | 'init'`。
  - `/api/build-info`：返回 `spawned_by`；UI status bar 显示。
- Out: daemon 自动空闲退出；后续卡。

# Acceptance

- [ ] Given `auto_spawn_daemon: true` 且 daemon 未起, When hook 触发, Then
      hook ≤100ms 返回 + daemon 在 1-2s 内起来 + 新事件可见。
- [ ] Given `auto_spawn_daemon: false`, When hook 触发, Then 行为同今日
      （disk-queue，daemon 不自拉）。
- [ ] Given 端口冲突 / spawn 失败, When hook 自拉, Then hook 不报错不阻塞，
      事件进 disk-queue。
- [ ] Given hook 自拉的 daemon, Then `/api/build-info` 里 `spawned_by:
      "hook"`；UI status bar 显示来源。
- [ ] Given 多个 hook 同时触发, Then 最多 1 个 daemon 存活（pid 互斥锁兜
      底）。

# Plan

- [ ] T1 config 读写 util（放 `paths.ts` 或新 `config.ts`）。
- [ ] T2 capture 路径加 `maybeSpawnDaemon()`：`tryProbe(daemon.json.port)`
      失败 → 读 config → spawn detached。
- [ ] T3 `serve.ts` 加 `--quiet`；起 daemon 时写 `spawned_by`（来自
      `MINSPECT_SPAWNED_BY` 环境变量，由 capture 设）。
- [ ] T4 daemon.json schema 更新 + 读取处兼容老文件（缺字段按 `"user"` 处
      理）。
- [ ] T5 `/api/build-info` 返回 `spawned_by`；UI status bar 小图标/tooltip。
- [ ] T6 单测：Windows `{ detached: true, windowsHide: true, stdio: 'ignore' }`
      不残留窗口；pid 互斥锁看到别人已 listen 就退出。

# Risks and Rollback

- Risk: Windows spawn detached 有 PS 窗口闪出（OpenCode 插件之前踩过
  一次）。缓解：强制 `windowsHide: true` + `stdio: 'ignore'`，参考 adapter
  的 fix。
- Risk: 并发 spawn 多个 daemon → 占端口失败的都退出。缓解：daemon 启动首
  步检查 `daemon.json` 里 pid 是否在跑，是就 exit 0 不重复起。
- Rollback: config 置 `auto_spawn_daemon: false`，行为回到今日。

# Notes

- 44 卡 init 的交互里会首次问是否启用 auto_spawn。本卡要确保"没答过 / 
  config 缺失"时默认关闭，绝不偷偷起。
- `spawned_by` 值枚举：`user`（CLI serve）、`init`（minspect init 起的）、
  `hook`（capture auto-spawn 起的）。
