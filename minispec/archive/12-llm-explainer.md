---
id: 12-llm-explainer
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: collector
---

# Why / Approach / Scope

见 changes/12。

# Acceptance / Plan

全部勾选或降级标注，见 changes/12。

## Execution notes

- SDK `@anthropic-ai/sdk ^0.90.0`，model `claude-haiku-4-5`。
- System prompt 带 `cache_control: {type: 'ephemeral'}`（prompt caching 形状就绪；当前 prompt 短于 4096-token 下限，实际不触发，将来 prompt 增长时自动生效）。
- `blame.ts` 写 hunk 时自动 INSERT OR IGNORE 到 `explain_queue`。
- AnthropicLike 接口便于测试 mock；生产用 `new Anthropic()`。
- 5 新测：success / cache hit / 3-retry drop / disabled / cache_control 传参校验。
- 降级：`daily_usd_cap` / `blocklist_globs` 字段保留但未实现门控（未来强化）。

## Check

- 102 tests 全绿；build + lint clean。

## Close

- `specs/collector.md` 已扩展 explainer 段（下次 `close` 同步增量文档）。
- 卡归档。
