# Adapters

各 agent adapter 把 agent 特有的数据源（hook payload、session log、chat history）归一化成 core 的 `Event` 流。本 domain 收敛跨 adapter 的共同契约，再各自登记每个具体 agent 的实现。

## Canonical rules（所有 adapter 必遵守）

- **纯函数 parse**：`parse(payload, ctx) -> Event[]`。Adapter 本身不做任何文件 / 网络 IO（例外：`reasoning.ts` 这种文件读取允许在 adapter 内，只要它不是 parse 本身）。
- **CLI 负责 IO 与 ID 生成**：`turn_id` / `tool_call_id` / `timestamp` / `git` / `file_edits` 的 `before_content` 与 `after_content` 都在 CLI 捕获 + 组装 + 传给 adapter。
- **file_edits 由 CLI 填充**：`ParseContext.file_edits` 填则 shape 之，不填则 `tool_call.file_edits = undefined`（非文件工具如 Bash）。
- **错误带字段**：缺字段抛自定义 `ParseError { field }`，方便 CLI 日志定位。
- **SessionStart → `session_start`；UserPromptSubmit → `turn_start`；PostToolUse → `tool_call`；Stop → `turn_end`**；session_end 由 CLI 推断发（各 agent 少有原生 session-end 信号）。

## Adapters

- [Claude Code](#claude-code)
- [Codex](#codex)
- [OpenCode](#opencode)
- _Aider_（卡 16）

---

## Claude Code

`@minspect/adapter-claude-code`

### Public surface

- `parse(payload: ClaudeCodePayload, ctx: ParseContext): Event[]`
- `extractReasoning(transcriptPath: string): { agent_reasoning?, agent_final_message? }`
- `ClaudeCodePayload`、`ParseContext`、`HookEventName`、`ParseError`、`FILE_EDITING_TOOLS` 类型/常量导出

### Rules specific to Claude Code

- **PreToolUse 不发事件**（parse 返回 `[]`），CLI 仅用来捕获 `before_content`。
- **transcript 两种 shape**：`{role, content}` 与 `{message: {role, content}}` 都支持，以覆盖 Claude Code 跨版本差异。
- **ExtractReasoning 以 last assistant message 为准**：从 JSONL 末尾逆扫，第一个 `role === 'assistant'` 的记录即被采纳；跳过 malformed JSON 行。
- **工具白名单（file-editing）**：`Edit` / `Write` / `MultiEdit` → CLI 会读 before/after 填 `file_edits`。`Bash` 等其它工具仍产生 `tool_call` 事件但无 file_edits。

### Changes

#### 04-adapter-claude-code (closed 2026-04-27)

**Why**
Claude Code 的 hook 体系最成熟、payload 最完整（含 transcript 路径）。首个 adapter 用来验证 Event 模型与整条链路。

**Scope**
- In: `parse.ts`（5 种 hook 事件映射）；`reasoning.ts`（transcript JSONL 抽 thinking + text）；7 份合成 fixture；15 个单测。
- Out: CLI 层（卡 05）；其它 agent。

**Acceptance（全部通过）**
- UserPromptSubmit → turn_start 保留 user_prompt。
- PostToolUse Edit / MultiEdit / Write file_edits 正确；Bash 无 file_edits。
- PreToolUse 返回空数组。
- Stop → turn_end。
- Transcript thinking + final text 正确回填；损坏行跳过，文件缺失不抛。
- 缺字段 → `ParseError` 带 `field`。

**Notes**
- Fixture 是基于文档合成（非真机捕获），真机测试留给卡 05 的 install + capture 集成。
- Adapter 零运行时 dep（除 `@minspect/core`）。

> 完整 Plan 与 Risks and Rollback：见 `minispec/archive/04-adapter-claude-code.md`.

---

## Codex

`@minspect/adapter-codex`

### Public surface

- `parseCodexLog(content: string, options?: ParseOptions): ParseCodexLogResult`
- `parseApplyPatch(input: string): ParsedPatchFile[]`、`toFileEdits(parsed): FileEdit[]`
- CLI 子命令：`minspect import-codex --session <path|uuid> | --latest` —— 读 `~/.codex/sessions/**/rollout-*.jsonl`，POST 到本地 collector。

### Rules specific to Codex

- **事后导入，非 hook 触发**：Codex CLI 没有暴露类似 Claude Code 的 hook 接口，所有会话通过 session log 回灌。logs live at `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO>-<uuid>.jsonl`。
- **Envelope `{timestamp, type, payload}`**：parser 按 `type:payload.type` 派发。
- **Record 映射**：`session_meta → session_start`；`event_msg:task_started → turn_start`；`event_msg:user_message` 填 `turn_start.user_prompt`；`event_msg:agent_reasoning` 累计 → `turn_end.agent_reasoning`；`event_msg:agent_message` 累计 → `turn_end.agent_final_message`；`event_msg:task_complete` / `turn_aborted → turn_end`；`response_item:function_call` + `*_output` 按 `call_id` 连接成一个 `tool_call`；`response_item:custom_tool_call`（`apply_patch`）同上。
- **apply_patch → file_edits**：patch 文本由 `parseApplyPatch` 解析为 `{Update|Add|Delete File, hunks}`；因为 log 里没有文件全量 before/after，parser 用 "context + '-' 行" 合成 `before_content`、"context + '+' 行" 合成 `after_content`，由 collector 的 hunk 管线算 diff。行号是相对 hunk 窗口的，非全文件绝对坐标 —— 这是已知 trade-off。
- **噪声 event 全量 skip**：`token_count` / `exec_command_end` / `patch_apply_end` / `turn_context` / `response_item:message` / `response_item:reasoning`（encrypted）都被忽略，不产生 warning。
- **幂等**：re-import 同一 log 不产生重复行（`session_id` / `turn_id` / `tool_call_id` 都来自 Codex 自己的 UUID；store 用 `ON CONFLICT DO NOTHING`）。
- **session_end** 由 parser 在文件尾追加（用最后一条事件的 timestamp）。

### Changes

#### 19-adapter-codex-real-parser (closed 2026-04-27)

**Why**
卡 11 只留了 stub。Codex 用户量增长中，没 adapter = 直接流失这部分用户。

**Scope**
- In: `parse.ts` 真实实现；`patch.ts` apply_patch 解析；`parse.test.ts` + `patch.test.ts` 共 20 tests；`packages/cli/src/commands/import-codex.ts` CLI 子命令；2 份 fixture（synthetic + 真 session 脱敏）。
- Out: live watcher（chokidar）；Codex thinking（encrypted，不解）。

**Acceptance（全部通过）**
- `parseCodexLog` 按序产出 `session_start` / `turn_start` / `tool_call` / `turn_end` / `session_end`。
- `minspect import-codex --session <...>` 把事件 POST 到 collector；`SELECT * FROM sessions WHERE agent='codex'` 能查到。
- `apply_patch` 含 `file_edits`（合成 before/after）；`function_call`（shell）无 file_edits。
- 同 session re-import → sessions/turns/tool_calls 均无重复行（Codex UUID + ON CONFLICT DO NOTHING）。
- 非法 JSON 行跳过 + 加 warning；缺 `call_id` 的 output 跳过 + warning；不抛。
- 真实脱敏 fixture 跑通无 `skip:*` warnings。

**Notes**
- Patch 行号 trade-off（hunk-relative）记录在 spec 规则里；未来如需全文件精确坐标，要求同时读一次 workspace 文件。
- `response_item:reasoning` 的 `encrypted_content` 目前不解；Codex 暴露明文后再接。

> 完整 Plan 与 Risks and Rollback：见 `minispec/archive/19-adapter-codex-real-parser.md`.

---

## OpenCode

`@minspect/adapter-opencode`

### Public surface

- `parseOpenCodeEnvelope(raw, prior?, options?): { events, next, warnings }` — 纯函数 reducer：输入单条 hook envelope + 上一轮 parser state，返回要发的 `Event[]` 和下一轮 state。
- `emptyOpenCodeState()`：初始 state。
- `OpenCodeParserState` 类型（以及若干 zod schemas：`OpenCodeEnvelopeSchema` / `SdkEventSchema` / `ToolBeforePayloadSchema` / `ToolAfterPayloadSchema`）
- CLI 入口：
  - `minspect install --agent opencode [--scope user|project]` — 把 plugin 文件写到 `~/.config/opencode/plugins/minspect.ts`（user）或 `.opencode/plugins/minspect.ts`（project），幂等 + 备份。
  - `minspect capture-opencode` — 从 stdin 读一条 envelope JSON，parse + send，**绝不阻塞 plugin 进程**。

### Rules specific to OpenCode

- **Plugin-hook-driven**：`@opencode-ai/plugin` 的 `Hooks` 接口下订阅三条：
  - 单一 `event` hook 覆盖所有 session / message / file 生命周期；
  - `tool.execute.before` + `tool.execute.after` 主要用于在 built-in `edit` / `write` 工具运行前后读取文件快照，补齐 `file_edits.before_content`。
- **Envelope shape**（plugin → CLI）：`{ hookName: 'event' | 'tool.before' | 'tool.after', payload, timestamp, git? }`。Plugin 通过 `spawn('minspect', ['capture-opencode']) + unref`，stdin 写 JSON，fire-and-forget。
- **Event 映射**（`event.type` → minspect `Event.type`）：
  - `session.created` → `session_start`（`agent = 'opencode'`，workspace = `info.directory`）
  - `message.updated` (role=user) → `turn_start`（turn_id = user message id，`user_prompt = ''`，后续 `message.part.updated` (TextPart) 原地 patch）
  - `message.part.updated` (ReasoningPart) → 累加到 state.pending_reasoning（last-write-wins，OpenCode 流式发全量文本）
  - `message.part.updated` (TextPart, assistant) → 累加到 state.pending_final_message
  - `message.part.updated` (ToolPart, state.status=completed/error) → `tool_call`（带 input/output/time；file_edits 在 `write`/`edit` 工具时抽，否则空）
  - `message.updated` (role=assistant, time.completed 已填) → `turn_end`（flush reasoning + final message）
  - `session.deleted` → `session_end`
  - 其余（`session.idle` / `file.edited` / `permission.*` / `lsp.*` / …）→ skip，parser 返回 `[]`
- **Tool-call dedup**：以 `callID` 为 key，parser state 记录 `emitted_tool_call_ids`，防止同一 ToolPart 的多次 completed 更新产出多条 tool_call。
- **file_edits 合成**：
  - `write`：`before_content` 来自 `tool.execute.before` 的 disk snapshot（若 `_minspect_before_content` 字段在 args 里），`after_content = input.content`。
  - `edit`：`before_content` 同上；`after_content` 用 `old_string.indexOf` + replace 合成（OpenCode edit 工具的原地等效行为）。若 plugin 给出 `_minspect_after_content`（未来可能扩展），优先用。
- **State 持久化**：parser 纯函数；CLI 层把 `OpenCodeParserState` 写到 `<state_dir>/sessions/opencode-<session_id>.json`（与 Claude Code 的 session-state 同目录但不同前缀，避免互相覆盖）。
- **宽进严出**：所有 SDK schema 多数字段 optional + 末尾带 `z.object({type: z.string()}).passthrough()` 兜底；未识别事件直接 skip 返回 `[]`，不抛、不告警（告警留给明显损坏的 envelope shape）。

### Changes

#### 38-adapter-opencode-real (closed 2026-04-28)

**Why**
卡 15 只留了 stub。OpenCode 用户群增长中，没 adapter = 这部分 session 的 blame / revert / search 全部拿不到。

**Scope**
- In: `packages/adapters/opencode/src/{types,parse}.ts` 真实实现；`parse.test.ts` 9 cases；`packages/cli/src/commands/capture-opencode.ts` 入口 + 4 integration tests；`packages/cli/src/commands/install-opencode.ts` + plugin 模板 + 5 tests；`@minspect/cli` 新增 workspace dep `@minspect/adapter-opencode`；adapter 新增 zod dep。
- Out: npm 包形态 plugin（写文件 drop-in 足够）；OpenCode SDK v2 差异；自定义 tool 注册；真机 smoke 留作 post-close 人工验证。

**Acceptance（全部通过）**
- 9 parser unit tests：session.created / turn_start patch / ToolPart (write) / tool.before + edit 合成 / reasoning + text 串联 / session.deleted / 未知 event / malformed envelope / status=error。
- 4 capture-opencode integration tests：session.created POST、collector 离线落队列、malformed envelope 不抛、完整 user→tool→assistant 产 4 条事件序列。
- 5 install-opencode tests：首写、idempotent 备份、foreign 文件备份后覆盖、自动建目录、Windows 反斜杠转义。
- `pnpm -r test --run` 246 tests 全绿；biome clean；所有包 build 通过。

**Notes**
- Plugin 接口基于真实安装的 `@opencode-ai/plugin@1.2.27`（`dist/index.d.ts`）+ `@opencode-ai/sdk` 的 `Event` 联合类型，不是文档页描述的字符串 event 名映射。原 card 38 初版对接口的理解有偏差，落地时以真实类型为准。
- Plugin 模板用 `spawn(minspect, ['capture-opencode']) + unref` 而不是 `fetch(collector)`：前者复用 CLI 的磁盘队列 / 校验 / 超时，和 Claude Code hook 对称；后者需要 plugin 自己读 state.json 找 port、处理重试。
- 真机 smoke 未跑：card acceptance 不依赖真机，但使用 OpenCode 的用户跑一段后若发现字段漂移，修 `types.ts` / `parse.ts` 的 schema 即可（当前 schema 走宽进策略已留足容错）。
- 参考：[OpenCode Plugin API docs](https://opencode.ai/docs/plugins) + 本机 `~/.config/opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts` + `@opencode-ai/sdk/dist/gen/types.gen.d.ts`。

> 完整 Plan 与 Risks and Rollback：见 `minispec/archive/38-adapter-opencode-real.md`.

#### 15-adapter-opencode (closed 2026-04-27, superseded by 38)

Skeleton-only：建包骨架，`parseOpenCodeEvent` 返空。卡 38 把实现补齐。
