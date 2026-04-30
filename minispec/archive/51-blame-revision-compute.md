---
id: 20260430-blame-revision-compute
status: closed
owner: ivenlau
---

# Why

Revisions popover 现在点一个版本只滚到对应行，看到的仍是"最新"文件。用户
想要"点 revision N，看到当时的文件全文 + 当时的 blame"——类似 `git blame`
的 `-at`。本卡是后端侧：新增一个纯函数和一个 API 参数，不改 UI。

# Approach

- Considered:
  - 新增 `historical_blame` 表写库：append 很大，且 blame 可重算，不值。
  - 每次请求 on-the-fly 重算：pure function 串联，现有 `propagateBlame` 原样
    复用，内存只需要当前 file 行数 × 2，典型 < 100 ms。
- Chosen: on-the-fly 重算，纯函数 `computeBlameAtEdit`。

# Scope

- In:
  - `packages/collector/src/blame.ts::computeBlameAtEdit(store, workspaceId, filePath, targetEditId)`
    返回 `{ content, blame, chain_broken_edit_ids, target_created_at } | null`。
    null = 目标 edit 不属于该文件 / 已被 vacuum / blob 缺失。
  - `/api/blame?workspace=&file=&edit=<id>` 新增可选 `edit` 参数：没给走现行
    路径（line_blame 表 + 最后 blob content）；给了走 `computeBlameAtEdit`。
  - **响应 shape 和现在一模一样**（`{blame, turns, content, edits, chain_broken_edit_ids}`），
    UI 不需要区分分支。
- Out:
  - 缓存（留给后续性能卡）
  - UI 侧修改（卡 52）
  - AST overlay 按 revision 回退（AST 表目前只存 current，代价 ≫ 收益）

# Acceptance

- [ ] Given 一个文件有 N 个 edit, When 调用 `computeBlameAtEdit` 传入第 N
      个 edit 的 id, Then 返回的 `blame` 与当前 `line_blame` 表等价（行号、
      edit_id、turn_id、content_hash 全对齐）。
- [ ] Given 同样的文件, When 传入第 k 个 edit 的 id (k < N), Then 返回的
      `content` === 第 k 个 edit 的 `after_hash` 对应 blob 的 UTF-8 文本；
      `blame` 的每一行属于 edit[1..k] 中某一个。
- [ ] Given 链中某个 edit 的 `before_hash` 不等于前一个的 `after_hash`, When
      重放到那一点, Then 该 edit 在 `chain_broken_edit_ids` 里；之前的 blame
      在该点 reset（和 `updateBlameForEdit` 的 live 逻辑一致）。
- [ ] Given `GET /api/blame?workspace=&file=`（不带 edit）, Then 响应与本卡
      落地前完全一致（零回归）。
- [ ] Given `GET /api/blame?workspace=&file=&edit=<不合法 id>`, Then 返回
      400（或返回空 content + 空 blame，明确一种）。
- [ ] Given `GET /api/blame?workspace=&file=&edit=<id>`（id 属于该文件的某
      中间 edit）, Then 响应字段名、类型、shape 与不带 edit 时完全对齐。

# Plan

- [ ] T1 `packages/collector/src/blame.ts` 新增 `computeBlameAtEdit`：
      - 查目标 edit 行（workspace + file + id 匹配，否则 return null）
      - `SELECT * FROM edits WHERE workspace_id=? AND file_path=? AND
        created_at <= ? ORDER BY created_at ASC` 拿到时间升序 edit 列表
      - 从头循环：每个 edit 取 before/after blob 内容，链断判定同
        `updateBlameForEdit` 的逻辑（`edit[k].before_hash !== edit[k-1].after_hash`
        → prior_blame = null）
      - 每一步调 `propagateBlame`，到达 target 时返回：
        - `content` = target.after_hash 对应 blob（缺失时 `''`）
        - `blame` = 当前循环产出的 BlameRow[]
        - `chain_broken_edit_ids` = 本次循环累计
      - Expected output: 纯函数（只读 store），可单测。
- [ ] T2 `packages/collector/src/api.ts` `/api/blame` 分支处理：
      - query 里有 `edit` 时走 `computeBlameAtEdit`，组装成现有响应 shape
        （blame 行要 JOIN tool_calls.explanation + edits.created_at；turns
        从 blame 中出现过的 turn_id 集合取；`edits` 仍返回完整链）
      - 没有 `edit` → 零行代码变化
- [ ] T3 `packages/collector/src/blame.test.ts` 新增：
      - 重放到最末 edit 等价于 `line_blame`（至少 3 个 edit 的 fixture）
      - 重放到中间 edit：content 匹配那时 after blob，blame 不含 later edit
      - 链断场景：制造 `before_hash` 不匹配的中间 edit，验证 reset
      - 目标 edit 不属于该文件 → return null
      - target 的 blob 缺失 → `content === ''`，blame 仍然可用
- [ ] T4 `packages/collector/src/api.test.ts` 新增：
      - `/api/blame?edit=<id>` 响应 shape 与不带 edit 一致
      - 非法 edit id → 合理行为（400 或空响应，定一种就行）
- [ ] T5 同步 `minispec/specs/collector.md`：记录 `computeBlameAtEdit` 签名
      + API `?edit=` 参数 + 和 live 路径的行为对齐声明。

# Risks and Rollback

- Risk: 重放顺序或链断判定与 `updateBlameForEdit` 有细微偏差 → 最末 edit
  重放结果 ≠ 当前 `line_blame`，现有 blame 页面诡异。
  缓解：测试 T3.1 正是这条。两条路径都应调用同一个 `propagateBlame`，链断
  判定也抽成共用辅助（必要时）。
- Risk: Codex 来源文件（after blob 是 hunk 窗口碎片）重放结果也是碎片，但
  这是**当前视图就有的已知限制**，不是本卡引入。卡 52 横幅说明。
- Risk: 一个文件有几百个 edit 时响应变慢。
  缓解：首版不缓存；实测瓶颈后再加。
- Rollback: 删 `computeBlameAtEdit`，`/api/blame` 移除 `edit` query 解析。
  UI 卡 52 同步下架。

# Notes

- `propagateBlame` 本身是 pure function，零 IO，可复用。
- 现有 `/api/blame` 的 `content` 字段就是从 `edits.after_hash` 对应 blob 取
  的（不是磁盘），所以历史和当前走的是同一语义，不会让用户感到"两个不同的
  视图"。
- `vacuum --fix` 的孤儿 blob 条件 `NOT EXISTS ... e.before_hash=b.hash OR
  e.after_hash=b.hash` 已经把所有 edit 引用的 blob 保留，历史重放没有丢数
  据的风险。
