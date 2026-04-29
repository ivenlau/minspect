---
id: 08-indexer-ast
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: collector
scope_adjusted: true
---

# Scope 调整说明

原卡要求 tree-sitter 6 语言。**实际降级为 regex（仅 JS/TS）**；其它语言回退 `kind='file'` 整文件节点。理由：tree-sitter 跨平台原生构建风险高，MVP 重点是 JS/TS。`extractAstNodes` 是单一接口点，未来替换成 tree-sitter 无下游改动。

# Acceptance / Plan / Risks

见 changes/08（checkboxes 与降级标注）。

## Execution notes

- 无新依赖。`ast.ts` 纯函数 + `updateAstForEdit` 对接 Store 事务。
- 4 条 regex：顶层 function、arrow/function const、class、method。`findBlockEnd` 用 `{}` 栈算 end_line。
- `edit_ast_impact` 按 hunk 区间相交判定。
- 7 新测（extract 5 + Store 集成 2）。

## Check

- 88/88 tests；lint clean；build 5 包全绿。

## Close

- 更新 `specs/collector.md` 的 Change 08 章节 + scope 调整说明。
- 卡归档。
