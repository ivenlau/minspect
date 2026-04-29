---
id: 15-adapter-opencode
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: adapters
scope_adjusted: true
---

# Scope 调整

原计划：OpenCode plugin 入口 + install 扩展 + 真机验证。
**MVP 实际**：skeleton 包 `@minspect/adapter-opencode`；`parseOpenCodeEvent(event): Event[]` 存根。

**理由**：此环境未装 OpenCode，plugin API 需针对特定版本适配；无 live 环境盲写风险高。

# Close

包骨架 `packages/adapters/opencode/` 落地；build 绿；契约就绪。
