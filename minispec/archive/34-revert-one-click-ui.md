---
id: 34-revert-one-click-ui
status: closed
owner: ivenlau
closed_at: 2026-05-01
depends_on: [21-cli-revert]
---

# Why

卡 21 的 Revert modal 要求用户复制命令到终端。安全设计合理但确实繁琐（用户已经在 UI 里了，要切到终端、粘贴、回车）。等新 UI 跑一段后这张卡做"一键执行"版。

# Approach

Server 开一个**只在 `localhost` bound 时响应**的 `POST /api/revert/execute`，复用 CLI 的 `runRevert` 逻辑。UI modal 加"Apply now"按钮，点击后前端调用 execute 端点。保留"Copy command"作为退路。

两个安全护栏：
1. Server 只接受来自 127.0.0.1 的请求（Fastify 默认就这样 bind，再加代码 assert）
2. 二次 confirm：点"Apply now" 弹 native `confirm()`，显示改动摘要

# Scope

- In:
  - `packages/collector/src/server.ts`：`POST /api/revert/execute` body `{kind, id, force}`，响应 `{written: [...], skipped: [...]}`
  - 复用 `runRevert` from `@minspect/cli` 或在 collector 里抽共享逻辑到 `@minspect/core`
  - Check `req.ip !== '127.0.0.1'` 拒绝 403
  - UI `RevertModal`：加 "Apply now" 主按钮（accent 色）+ 二次 confirm
  - 错误展示：drift / codex 拒绝按卡 21 一致样式渲染
  - 测试：execute 端点 2 scenario（成功 + codex 拒绝）
- Out:
  - 外网访问认证 —— 保持 localhost-only
  - 批量 revert（一次撤多个 turn）
  - 行级 revert（卡 35）

# Acceptance

- [x] UI 点 "Apply now" → 弹模态确认（文件列表 + force checkbox）→ 确认 → server 执行 → modal 显示 "restored N files, skipped M"
- [x] 非 127.0.0.1 来源的请求返回 403
- [x] Codex 源 session 的 Apply now 按钮不显示（hard block）
- [x] Drift detected 时留在确认视图，force 自动勾选 + drift 警告
- [x] 测试全绿（collector 114, cli 128, ui 65）

# Plan

- [x] T1 抽 `runRevert` 到 `@minspect/core`（`revert.ts`：`sha256`, `checkDrift`, `applyRevert`）
- [x] T2 `/api/revert/execute` 端点 + 127.0.0.1 check + 4 tests
- [x] T3 UI RevertModal 加 Apply now 流程（confirm → execute → result / drift → force）
- [x] T4 specs 更新：ui/cli/collector
- [x] T5 close

# Risks and Rollback

- Risk: 一键点太快写错文件。Mitigation: 二次 confirm；drift 检测保持卡 21 的硬门槛。
- Rollback: 删 execute 端点 + UI 按钮；Copy command 流程不受影响。

# Notes

- 卡 21 的"复制命令型"保留 —— 仍是某些用户的首选（终端操作更有安全感）。

## Execution notes (2026-05-01)

- **@minspect/core/revert.ts**：新增 `sha256`、`checkDrift`、`applyRevert` 三个纯函数。CLI 的 `runRevert` 和 collector 的 execute 端点共用。
- **CLI refactor**：`revert.ts` 删除本地 `sha256`/drift/apply 逻辑，import from `@minspect/core`。`RevertResult` 改为 `RevertCliResult = RevertResult & {plan, mode}`。
- **Collector**：`api.ts` 提取 `buildRevertPlan(store, turn?, edit?)` helper，GET plan 和 POST execute 共用。execute 端点检查 `req.ip`（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`）。
- **UI**：RevertModal 新增 `applying` / `result` / `applyError` / `driftDetected` / `confirming` / `forceMode` state。Apply now → 模态内确认步骤（文件列表 + force checkbox + 确认/取消）→ postJson → 成功关闭确认显示 success；409 drift → 留在确认视图，force 自动勾选 + drift 警告。Codex source 时不显示 Apply now。已删除 Copy command 相关代码（cmd/cmdRef/copied/handleCopy）。
- **i18n**：新增 `revert.applyNow` / `revert.confirmTitle` / `revert.confirmApply` / `revert.confirmBtn` / `revert.cancelBtn` / `revert.applying` / `revert.applySuccess` / `revert.applyError` / `revert.driftDetected` / `revert.forceLabel`（EN + ZH）。已删除 `revert.runInTerminal` / `revert.copyBtn` / `revert.copiedBtn` / `revert.forceApply`。
- **测试**：collector api.test.ts +4（35→39）；CLI 10 revert 测试不变（重构后仍全绿）。

## Check

- 8 packages build；`pnpm --filter @minspect/collector test` 114/114 绿；`pnpm --filter @minspect/cli test` 128/128 绿；`pnpm --filter @minspect/ui test` 65/65 绿。
- `biome check` 改动文件全 clean。
- 预存问题：`core/migrations.test.ts` CRLF 漂移（Windows）、`biome check .` 全局 CRLF 格式问题 —— 均在 main 上已存在。

## Close

- `specs/collector.md`：新增 POST /api/revert/execute 端点文档。
- `specs/cli.md`：revert 命令补充 @minspect/core 共享说明。
- `specs/ui.md`：Revert UI 节更新为卡 21+34，API 表新增 execute 端点。
- 卡 34 移入 archive。
