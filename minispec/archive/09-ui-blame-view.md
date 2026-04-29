---
id: 09-ui-blame-view
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: ui
scope_adjusted: true
---

# Scope 调整

原计划 Vite + React + Monaco。**MVP 实际：vanilla HTML + JS 单文件**，hash 路由，pre 表格替代 Monaco。回滚路径：`getAppHtml()` 接口保留，未来替换实现即可。

# Acceptance / Plan

见 changes/09（checkboxes + 降级标注）。

## Execution notes

- collector 新增 5 GET API（sessions / files / turns / blame / ast）；`GET /` 返回 HTML shell。
- UI 一个文件：`src/app.html`，build 时复制到 `dist/app.html`。`getAppHtml()` 找 dist/src 兜底。
- 5 个新 API 测；1 个 HTML shell 测；93 total pass。
- Monaco / invalidated 样式标为 deferred；CSS class hook 保留。

## Check / Close

- lint / build / test 全绿。
- 新建 `specs/ui.md`；README 登记。
- 归档。
