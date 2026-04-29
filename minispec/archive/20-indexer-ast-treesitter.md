---
id: 20-indexer-ast-treesitter
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: collector
---

# Why

卡 08 只支持 JS/TS（regex），其它语言降级为整文件节点 —— Python / Go / Rust / Java 项目无法按方法聚合。tree-sitter 一次解决；`extractAstNodes` 是单点接口，替换风险可控。

# Approach

Native tree-sitter + 6 grammar + node-type walker（不用 `.scm` query），`classStack` 维护 qualified_name。

# Scope / Acceptance / Plan

全部勾选，详见 changes/20（注：T3 scope 微调 — 用 walker 替代 query，更轻）。

## Execution notes (2026-04-28)

- `tree-sitter ^0.22` + 6 grammar native bindings；Windows 12s 构建成功。
- Walker 驱动（替代 `.scm` query）：按 `classTypes` / `functionTypes` / `methodTypes` 三集合匹配；`classStack` 产 qualified_name。
- `variable_declarator` 特殊分支识别 `const foo = () => {}` arrow 形式。
- MAX_BYTES=1MB 性能守卫；超大文件 whole-file fallback。
- `getParser` 懒加载 + 缓存；装载异常 → 沉默 fallback。
- **Dist cache 坑**：tsc 增量不刷 dist/ast.js；大重写后 rm dist + .tsbuildinfo 再 build。
- 12 个 extractAstNodes 测试（5 新）+ 2 个 Store 集成；125 total pass。

## Check

- 125 tests pass; lint clean; build 5 包全绿。

## Close

- specs/collector.md AST 段更新留给下次触碰（现记录在卡 notes）。
- 卡归档。
