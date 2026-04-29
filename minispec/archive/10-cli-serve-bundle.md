---
id: 10-cli-serve-bundle
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: cli
scope_adjusted: true
---

# Scope 调整

前台模式（非 detached）。`ServeHandle.stop` 接口预留未来换实现。

# Acceptance / Plan

见 changes/10（checkboxes + 降级标注）。

## Execution notes

- cli 依赖 `@minspect/collector workspace:*`。
- `findRunningDaemon`：state + PID kill(0) + /health。
- `runServe`：复用 or listen + writeState + SIGINT cleanup；返回 `{port, reused, stop}`。
- `runStop`：kill 非自 PID + 清 state；stale 兜底。
- `openBrowser`：跨平台 detached spawn。
- 2 新测；96 total pass。

## Close

- 更新 `specs/cli.md` 加 serve / stop + Change 10。
- 卡归档。
