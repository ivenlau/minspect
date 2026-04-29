---
id: 16-adapter-aider
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: adapters
scope_adjusted: true
---

# Scope 调整

原计划：`.aider.chat.history.md` 解析 + git log 关联 + `import-aider` 子命令。
**MVP 实际**：skeleton 包 `@minspect/adapter-aider`；`parseAiderImport(input): Event[]` 存根。

**理由**：此环境没有 Aider repo 作为 fixture；版本差异大，盲写误差高。

# Close

包骨架落地；build 绿。
