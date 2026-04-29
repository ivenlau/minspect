---
id: 03-collector-foundation
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: collector
---

# Why

Collector 是整个系统的中央数据落盘点。没有它，hook 发出的事件无处接收、UI 无处查询。所有后续动态卡片（blame、ast、explainer、ui）都挂在它之上。

# Approach

- Considered:
  - 仅 HTTP（跨平台、调试友好）
  - 仅 Unix Socket（性能好但 Windows 语义不一致）
  - 两者都做
- Chosen: 仅 HTTP（localhost，端口随机，写状态文件）。决定性 trade-off：首要目标是 Windows 可用，Unix Socket 在本项目吞吐预估下不构成瓶颈，留作后续优化。

# Scope

- In:
  - `packages/collector/src/server.ts`：基于 `fastify` 的 HTTP server，暴露 `POST /events`、`GET /health`。
  - `packages/collector/src/store.ts`：基于 `better-sqlite3` 的写入层，session/turn/tool_call/edit/hunk/blob 插入。
  - `packages/collector/src/state.ts`：读写 `~/.minspect/state.json`（Windows `%LOCALAPPDATA%\minspect\state.json`），内含 `port`、`pid`、`started_at`。
  - Blob 内容寻址去重。
  - 基于 `better-sqlite3` 的事务封装。
  - 端到端集成测试：POST 事件 → SQLite 查得出。
- Out:
  - 行血缘计算（卡 07）
  - AST 索引（卡 08）
  - LLM Explainer（卡 12）
  - UI 静态资源托管（卡 09）

# Acceptance

- [x] Given collector 运行中 When POST 合法 `Event` Then 200 且数据落 SQLite
- [x] Given collector 运行中 When POST 非法 JSON Then 400 且返回 zod 校验错误
- [x] Given 并发 POST 100 条事件 Then 全部落盘无丢失无重复
- [x] Given 首次启动无状态文件 Then 自动生成端口并写入状态文件
- [x] Given collector 重启 Then 已有数据完整保留
- [x] Given POST 相同内容的文件快照 Then `blobs` 表按 hash 去重

# Plan

- [x] T1 状态文件 `~/.minspect/state.json`（含端口、PID）
- [x] T2 `server.ts`：fastify + `/events` POST（zod 校验）+ `/health`
- [x] T3 `store.ts`：各表写入函数 + blob 去重
- [x] T4 事务封装：一次 `tool_call` 写入（含多个 edit、hunks）在一个事务内
- [x] T5 集成测试：启动 server → POST 事件 → 直接查 SQLite 验证

# Risks and Rollback

- Risk: 端口占用。Mitigation: 5 次重试换端口，再失败报错退出
- Risk: 并发写 SQLite。Mitigation: `better-sqlite3` 默认串行；业务层用事务
- Rollback: revert；清掉 `~/.minspect/` 目录（可选）

# Notes

- 状态目录：Linux/mac `$XDG_STATE_HOME/minspect`；Windows `%LOCALAPPDATA%\minspect`
- SQLite 文件：`state_dir/history.sqlite`

## Execution notes (2026-04-27)

- 新增依赖：collector → `@minspect/core` / `better-sqlite3 ^11.8` / `fastify ^5`；dev `@types/better-sqlite3 ^7.6.11`。根 `pnpm.onlyBuiltDependencies` 追加 `better-sqlite3`。
- **workspace_id = workspace path**（不引入 UUID 层；path 天然唯一）。
- **MVP 整文件 hunk**：一次 edit 写 1 条 `hunks` 行（`old_text=before`、`new_text=after`）；卡 07 引入 `diff` 库后替换为行级 hunk 序列。
- **ID 生成**：`edit_id = ${tool_call_id}:${idx}`、`hunk_id = ${edit_id}:0`，确定性可重算。
- **幂等**：INSERT 带 `ON CONFLICT(id) DO NOTHING`；blobs 用 `INSERT OR IGNORE`，disk 队列重放安全。
- **事务**：`ingest()` 内部 `db.transaction`；tool_call 引用未知 session → 抛错 + 回滚（测试覆盖）。
- core 补 `SessionStartEvent` 等命名 type 导出，collector 不依赖 zod。
- Fastify v5 + `fastify.inject()`，集成测试无需真端口。
- better-sqlite3 11.10.0 在 Node 24 + Windows MSVC 下从源码编译成功（约 1 分钟）。

## Check (2026-04-27)

| 项 | 命令 | 结果 |
|---|---|---|
| A1 install | `pnpm install --frozen-lockfile` | Already up to date / 784ms |
| A2 build | `pnpm -r build` | 5 包全绿 |
| A3 test | `pnpm -r test` | core 14/14 + collector 16/16，其余空跑 |
| A4 lint | `pnpm lint` | `Checked 32 files`, no fixes |

验收映射证据：
- 200 持久化 / 400 zod issues / 100 并发 / blob 去重 → `server.test.ts` + `store.test.ts`
- 状态文件 round-trip / 损坏返回 null → `state.test.ts`
- 事务回滚 → `store.test.ts > rolls back the transaction on failure`

## Close (2026-04-27)

- 新建 `minispec/specs/collector.md`（collector domain），含 Public surface、Endpoints、Canonical rules、ID 规则、hunks MVP 策略说明。
- `specs/README.md` 登记 collector.md。
- 卡状态 `in_progress` → `closed`，文件自 `changes/` 归档。
