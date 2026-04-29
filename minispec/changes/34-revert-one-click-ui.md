---
id: 34-revert-one-click-ui
status: draft
owner: ivenlau
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

- [ ] UI 点 "Apply now" → 弹 native confirm → yes → server 执行 → modal 显示 "restored N files, skipped M"
- [ ] 非 127.0.0.1 来源的请求返回 403
- [ ] Codex 源 session 的 Apply now 按钮 disabled + tooltip 解释
- [ ] Drift detected 时显示 drift file list + "Force apply" 按钮
- [ ] 测试全绿

# Plan

- [ ] T1 抽 `runRevert` 到 `@minspect/core` 或在 collector 里直接引用 CLI 包
- [ ] T2 `/api/revert/execute` 端点 + 127.0.0.1 check + test
- [ ] T3 UI RevertModal 加 Apply now 流程
- [ ] T4 specs 更新：ui/cli/collector
- [ ] T5 close

# Risks and Rollback

- Risk: 一键点太快写错文件。Mitigation: 二次 confirm；drift 检测保持卡 21 的硬门槛。
- Rollback: 删 execute 端点 + UI 按钮；Copy command 流程不受影响。

# Notes

- 卡 21 的"复制命令型"保留 —— 仍是某些用户的首选（终端操作更有安全感）。
