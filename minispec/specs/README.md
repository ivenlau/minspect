# Canonical Specs

每个文件一个领域，归档已 `close` 的 change 沉淀下来的契约与规则。

## Domains

- [foundation.md](foundation.md) — monorepo 结构 / 工具链 / 跨领域工程约束
- [core.md](core.md) — `@minspect/core` 契约：Event / DB schema / git 辅助
- [collector.md](collector.md) — `@minspect/collector`：HTTP server、SQLite store、状态文件
- [adapters.md](adapters.md) — 各 agent adapter 契约（Claude Code 已落；Codex/OpenCode/Aider 待建）
- [cli.md](cli.md) — `minspect` CLI 命令、hook 协议、会话状态、磁盘队列
- [ui.md](ui.md) — Web UI 路由与 API 契约（vanilla HTML MVP）

## 约定

每个领域 spec 从已 close 的 change 中抽取：

- Why
- Scope
- Acceptance（通过状态）
- Notes

而 Plan / Risks and Rollback 保留在 `minispec/archive/<id>.md`，spec 中以 `> 完整…：见 archive/…` 做交叉引用。
