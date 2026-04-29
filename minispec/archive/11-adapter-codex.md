---
id: 11-adapter-codex
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: adapters
scope_adjusted: true
---

# Scope 调整

原计划：Codex session log 解析器 + import 命令 + watcher + 6 测试。
**MVP 实际**：skeleton 包 `@minspect/adapter-codex`；`parseCodexLog(log): Event[]` 存根返回 `[]`。

**理由**：此环境未装 Codex CLI，无真实 session log fixture 作为测试地基；盲写解析器有回归风险。契约与包结构就绪，fixture 可用时替换 `parseCodexLog` 即可，无需改下游任何包。

# Acceptance / Plan

全部标记"deferred pending real Codex session log fixture"。
Build / lint 全绿；包可以被 collector 或 cli 直接 `workspace:*` 依赖。

## Close

- 包骨架落地：`packages/adapters/codex/{package.json, tsconfig.json, src/index.ts}`
- `specs/adapters.md` Codex 条目标记待建。
- 原 changes/11 删除（未经历 in_progress 的详细 apply）。
