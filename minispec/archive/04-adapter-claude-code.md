---
id: 04-adapter-claude-code
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: adapters
---

# Why

Claude Code 的 hook 体系最成熟、payload 信息最完整（含 transcript 路径 → thinking block 可回填 reasoning）。选它作为首个 adapter 可以最快验证 Event 模型和整条链路。

# Approach

- 单一合理路径：纯函数 `parse(eventType, payload) -> Event[]`，不持有 IO；transcript 读取独立模块 `reasoning.ts`，在 `Stop` 事件时调用。
- 为什么纯函数：可测试性最高；hook 入口（卡 05）只负责 IO 与转发，adapter 只做解析。

# Scope

- In:
  - `packages/adapters/claude-code/src/parse.ts`：处理 `SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` 五种 hook。
  - `packages/adapters/claude-code/src/reasoning.ts`：`Stop` 时读取 `transcript_path` 指向的 JSONL，提取最后一轮 assistant 的 `thinking` 与 `text` block。
  - 至少 6 份真实脱敏 payload fixture（实际落地 7 份合成 fixture）。
  - 工具类型白名单：`Edit` / `Write` / `MultiEdit` / `Bash`。
- Out: CLI 入口（卡 05）；install 命令（卡 05）；其它 agent adapter。

# Acceptance

- [x] UserPromptSubmit → turn_start with `user_prompt`
- [x] PostToolUse Edit → tool_call with file_edits
- [x] PostToolUse MultiEdit → tool_call preserving file_edits
- [x] Stop + transcript → extractReasoning 填 agent_reasoning
- [x] 缺字段 → ParseError 带 field

# Plan

- [x] T1 7 份合成 fixture（基于 Claude Code 文档）
- [x] T2 parse.ts 各 hook 类型映射
- [x] T3 reasoning.ts JSONL 解析（两种 shape 兼容）
- [x] T4 边界：Bash 无 file_edits、malformed JSON 行跳过、transcript 缺失不抛

# Risks and Rollback

- Risk: Claude Code hook schema 随版本变化。Mitigation: 精简 parser + 强测试；升级时只改 adapter
- Rollback: revert 包；core、collector 不受影响

# Notes

- Transcript 文件路径在 hook payload 的 `transcript_path` 字段
- `SessionStart` payload 含 `session_id`，之后所有事件用它关联

## Execution notes (2026-04-27)

- 依赖：adapter → `@minspect/core` 单一 workspace 依赖。
- **纯函数 + ctx 注入**：`parse(payload, ctx)`。`ctx` 携带 timestamp / git / turn_id / tool_call_id / file_edits / reasoning。
- **file_edits 由 CLI 填**：PreToolUse 捕获 before，PostToolUse 捕获 after，CLI 组装传给 adapter。
- **PreToolUse 返回 `[]`**：仅用于 CLI 读 before_content。
- **Stop → turn_end**（不发 session_end）：session_end 由 CLI 基于 idle / exit 判定。
- **Fixture 为合成**：7 份基于文档构造，覆盖 SessionStart / UserPromptSubmit / PostToolUse(Edit/Write/MultiEdit/Bash) / Stop。真机 fixture 替换留给卡 05 集成测试。
- **transcript 两种 shape**：`{role, content}` 与 `{message: {role, content}}` 都支持。

## Check (2026-04-27)

| 项 | 命令 | 结果 |
|---|---|---|
| A1 install | `pnpm install --frozen-lockfile` | Already up to date |
| A2 build | `pnpm -r build` | 5 包全绿 |
| A3 test | `pnpm -r test` | 45 通过（core 14 + collector 16 + adapter-claude-code 15） |
| A4 lint | `pnpm lint` | `Checked 44 files`, clean |

## Close (2026-04-27)

- 新建 `minispec/specs/adapters.md`（adapters domain），含 Canonical rules + Claude Code 子章节。
- README 登记 `adapters.md`。
- 卡状态 closed，文件归档。
