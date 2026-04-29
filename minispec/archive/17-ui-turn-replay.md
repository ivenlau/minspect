---
id: 17-ui-turn-replay
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: ui
scope_adjusted: true
---

# Scope 调整

原计划：Monaco side-by-side diff 步进回放，tool_call 粒度，文件状态重建，快捷键。
**MVP 实际**：`#/replay?session=<id>` hash route，turn 级 prev/next 按钮，展示 prompt + 文件列表 + reasoning。

**理由**：跟随卡 09/13 的 vanilla HTML 策略；tool_call 级重建需要 blob 查询 API，留给后续。

# Acceptance

- [x] 打开 `#/replay?session=<id>` 走 prev/next 步进
- [~] tool_call 粒度 / Monaco diff / 文件状态重建：scope 降级

# Close

`packages/ui/src/app.html` 已加 `showReplay`。
