---
id: 20260429-cli-fixed-port
status: closed
owner: ivenlau
---

# Why

`minspect serve` 现在监听随机端口。导致：UI 浏览器书签无法固定；reload
丢 localStorage（lang、theme、dashboard range 按 origin 隔离）；每次启动
要从 stdout 找端口。运行体验不稳，是后续安装体验优化的底层前置。

# Approach

- Considered:
  - 完全硬编码 21477：简单，但冲突时 `serve` 直接失败。
  - 固定 + 冲突 fallback + `--port` 覆盖。
- Chosen: 固定 + fallback + `--port`。默认 21477；占用时按 21478…21486 顺
  序探测；`--port` 明指时不 fallback，失败就失败（用户显式意图）。

# Scope

- In: `serve.ts` 默认端口；`resolvePort(start)` 工具；stdout 提示"defaulted
  to N because 21477 was busy"。daemon.json 写实际端口（已是这样）。
- Out: 写用户级配置文件（该卡不引入）。

# Acceptance

- [ ] Given 无端口占用, When `minspect serve`, Then 监听 21477。
- [ ] Given 21477 被占, When `minspect serve`, Then 落到 21478（或下一个可
      用），stdout 打印原因。
- [ ] Given `--port 31000` 且 31000 空闲, When `minspect serve`, Then 监听
      31000。
- [ ] Given `--port 31000` 且 31000 被占, When `minspect serve`, Then 失败
      退出（不 fallback），错误消息明确。
- [ ] Given 重启 serve, When 21477 仍空闲, Then 仍是 21477，UI localStorage
      持续有效。

# Plan

- [ ] T1 `packages/cli/src/commands/serve.ts`：`runServe({ port })` 默认
      `resolvePort(21477)`；`--port` 明指跳过探测。
  - Expected output: 行为如 Acceptance。
- [ ] T2 新增 `resolvePort(start, range = 10)` 工具：尝试 `net.createServer().listen(p, '127.0.0.1')`，
      `EADDRINUSE` → p+1；超出 range 抛错。
  - Expected output: 单测覆盖占用/空闲。
- [ ] T3 `serve.test.ts` 新增用例：占用 21477 → 落到 21478；占用 `--port`
      → 报错。
- [ ] T4 `README.md` / `minispec/specs/cli.md` 记录稳定端口；UI "Known URLs"
      片段。

# Risks and Rollback

- Risk: 21477 长期被其它工具占 → 每次 fallback，书签仍飘。可接受；后续加
  用户配置卡再解。
- Rollback: `--port 0` 回到随机（Node 行为）。

# Notes

- 21477 选自"mins"区间无实际语义，属可用冷门端口段。
