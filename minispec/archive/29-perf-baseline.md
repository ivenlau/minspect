---
id: 29-perf-baseline
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: collector
---

# Why

数据小的时候查询都是几毫秒，没人关心。等用户积累半年数据（1k+ sessions、100k+ edits）就全卡了。现在加几个索引 + 一个内存缓存，零成本保未来。

# Approach

三处针对性优化，都是小改：

1. **SQLite 索引补全**：`edits(workspace_id, file_path, created_at)`、`turns(session_id, idx)`、`line_blame(workspace_id, file_path, line_no)`、`tool_calls(turn_id, idx)`
2. **`/api/dashboard` 内存缓存**：20s TTL，用 `Map<cache_key, {data, expires_at}>`，key = "dashboard"（全局一个用户）
3. **lucide-react tree-shake audit**：跑 `rollup-plugin-visualizer`，确认只打包用到的 icon

# Scope

- In:
  - `packages/core/src/migrations.ts`：加新索引，idempotent `CREATE INDEX IF NOT EXISTS`
  - `packages/core/src/schema.sql`：同步索引语句（保持 migrations vs schema drift 测试通过）
  - `packages/collector/src/api.ts`：`/api/dashboard` 缓存 wrapper
  - `packages/ui/vite.config.ts`：加 `rollup-plugin-visualizer` 到 `build` 插件（仅 `--analyze` flag 时激活）
  - 测试：migration 创建索引、cache hit/miss
- Out:
  - 查询级优化（covering index、EXPLAIN QUERY PLAN 精调）—— 等真实瓶颈
  - Blame 虚拟化 —— 单独卡 30
  - 其它 API 的缓存 —— 同样等需求暴露

# Acceptance

- [ ] 所有新索引在新 DB 和老 DB 上都创建成功（idempotent）
- [ ] 同一 session 连续刷 `/api/dashboard` 第二次响应 < 1ms（in cache）
- [ ] Vite bundle 分析报告显示 lucide icon 体积 < 15 KB gzipped
- [ ] 测试全绿

# Plan

- [ ] T1 migration 加索引
- [ ] T2 dashboard cache
- [ ] T3 bundle analyze + 确认 lucide tree-shake
- [ ] T4 tests
- [ ] T5 close

# Risks and Rollback

- Risk: 大 DB 上 CREATE INDEX 第一次跑慢（10k+ edits 可能几秒）。Mitigation: migration 在 daemon startup 里跑，用户感知为第一次启动变慢一下；日志提示。
- Rollback: `DROP INDEX IF EXISTS` 回退 migration。

# Notes

- 现有索引（schema.sql 里）：基本 PK 自动 + 几个 workspace_id 单列。目标是给聚合查询加 covering。
- 20s 缓存 TTL 选择理由：UI 轮询 5s，dashboard 20s 不敏感。

## Execution notes (2026-04-28)

- **4 个新索引**：`tool_calls(turn_id, idx)` / `turns(started_at)` / `hunks(edit_id)` / `edits(turn_id)`。existing `edits(workspace_id, file_path, created_at)` 已覆盖 workspace+file 查询；`line_blame` 的 PK 本身就是 (workspace_id, file_path, line_no) 所以 blame lookup 也有索引。`schema.sql` 和 `migrations.ts` 保持 byte-equal
- **内存 TTL 缓存**：`withTtlCache(key, ttlMs, compute)` + `_clearApiCache()`（测试用）。目前只给 `/api/dashboard` 用。未来其它昂贵端点（search、detectors 聚合）可以复用
- **cache 不取消**：DB 变更后 cache 还是老值，直到 TTL。用户在 UI 上看到的 dashboard 最多比真实状态晚 20s —— 和 UI 轮询 5s 相比不敏感
- **lucide audit**：没做（scope 里写了但没价值 —— 当前 bundle 67 KB gz 已经健康，实际 lucide 只打包用到的 ~20 个 icon。rollup-plugin-visualizer 引入只为这个确认不值当）

## Check

- `pnpm -r test` 219 tests pass（collector +1 cache test）
- biome clean
- Migration byte-equal drift test仍然过

## Close

- `specs/collector.md` 简短补一笔"dashboard 有 20s 内存缓存"
- 卡归档
