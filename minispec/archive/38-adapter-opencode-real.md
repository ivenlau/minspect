---
id: 38-adapter-opencode-real
status: closed
owner: ivenlau
depends_on: [15-adapter-opencode]
spec: adapters
closed: 2026-04-28
---

# Why

卡 15 把 `@minspect/adapter-opencode` 落成 16 行 stub（`parseOpenCodeEvent` → `[]`）。OpenCode 是开源 AI coding agent（sst/opencode），用户群持续增长；stub 之后没接，这些 session 的 blame / revert / 搜索全部拿不到。和 Codex 卡 19 对卡 11 的关系对称：从 skeleton 升到真实实现。

# Ground truth（基于真实安装）

用户机器已装 OpenCode：
- Config: `C:\Users\admin\.config\opencode\opencode.json`（有 `plugin: ["oh-my-opencode@latest"]`、MCP 配置、zhipuai provider）
- Plugin SDK: `@opencode-ai/plugin@1.2.27`，`@opencode-ai/sdk` 在同目录下
- 安装位置：`C:\Users\admin\.config\opencode\node_modules\@opencode-ai\plugin`

## Plugin 接口（来自 `dist/index.d.ts` 实际类型）

```ts
export type Plugin = (input: PluginInput) => Promise<Hooks>;

export interface Hooks {
  // 核心订阅：所有 session / message / file 生命周期事件都走这一个
  event?: (input: { event: Event }) => Promise<void>;

  // 针对性拦截点（OpenCode 文档里说的 "tool.execute.before" 等其实是这些
  // 直接命名的 Hook，不是通过 event 流进来的字符串类型）
  "chat.message"?: (input, output) => Promise<void>;
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>;
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => Promise<void>;
  // 其它 permission / command / experimental hooks，minspect 用不到
}
```

Plugin 是一个 default export 的 async function，返回 `Hooks`。**插件在 OpenCode 进程内直接运行**（Bun runtime），不是 fork 的子进程。

## Event 联合（来自 SDK `types.gen.d.ts` 真实类型）

```ts
export type Event =
  | EventSessionCreated   // { type, properties: { info: Session } }
  | EventSessionIdle      // { type, properties: { sessionID } }
  | EventSessionDeleted
  | EventSessionUpdated | EventSessionStatus | EventSessionCompacted | EventSessionError | EventSessionDiff
  | EventMessageUpdated   // { type, properties: { info: UserMessage | AssistantMessage } }
  | EventMessagePartUpdated  // { type, properties: { part: Part } }
  | EventMessageRemoved | EventMessagePartRemoved
  | EventFileEdited       // { type, properties: { file: string } } — path only, 无 diff
  | EventPermissionUpdated | EventPermissionReplied
  | EventLspClientDiagnostics | EventLspUpdated
  | EventTodoUpdated | EventCommandExecuted
  | EventTuiPromptAppend | EventTuiCommandExecute | EventTuiToastShow
  | EventPtyCreated | EventPtyUpdated | EventPtyExited | EventPtyDeleted
  | EventServerConnected | EventServerInstanceDisposed
  | EventInstallationUpdated | EventInstallationUpdateAvailable;
```

## Part 联合（`message.part.updated` 里的真正数据）

```ts
type TextPart       = { type: 'text'; text: string; time?: {start, end?} };
type ReasoningPart  = { type: 'reasoning'; text: string; time: {start, end?} };
type ToolPart       = { type: 'tool'; callID; tool; state: ToolState };
type ToolStateCompleted = {
  status: 'completed';
  input: Record<string, unknown>;
  output: string;
  title: string;
  metadata: Record<string, unknown>;
  time: { start, end };
};
```

**核心发现**：`ToolPart` 在 `state.status === 'completed'` 时一条事件里**同时带 input + output**。不需要去配对 before/after。`ReasoningPart` / `TextPart` 直接给到 `agent_reasoning` / `agent_final_message`。

# Approach

- Considered:
  - **A. 单一 `event` hook 订阅 + filter by event.type**：覆盖度全面，一个 hook 拿所有 session lifecycle + message parts。
  - **B. 用 `tool.execute.before/after` 做 tool_call 归因**：好处是直接拿 args 对象；坏处是需要 callID 配对，且 ToolPart 在 event 里已经有 input+output，信息冗余。
  - **C. Plugin 内直接 `fetch('/events')` POST 到 collector**：无子进程开销，但：(1) 失败无磁盘队列；(2) collector port 要从 `<state>/daemon.json` 读，增加依赖面；(3) 违反 minspect "hook 绝不阻塞 agent" 约定（fetch 即使不 await 仍在 event loop 里）。
  - **D. Plugin 每个 event `spawn('minspect', ['capture-opencode'])` + stdin JSON + unref**：复用 CLI 既有的 `sendEvent` + 磁盘队列 + 校验 + 超时；失败路径和 Claude Code hook 完全对称；每个事件 ~20ms spawn 成本可接受。
- Chosen: **A + D**。订阅单一 `event` hook 覆盖主流程；tool.execute.before 只用于"抓 before_content"（fs.readFile 缓存到 side map by callID，after 时 match）；所有事件 spawn `minspect` 子进程发出，不阻塞。

# Scope

- In:
  - `packages/adapters/opencode/src/types.ts`：真实 hook payload 类型（基于 `@opencode-ai/sdk` 的 Event 联合）+ zod schemas。不依赖 SDK 包（保留 type-only reference），adapter 自行定义对齐的 zod。
  - `packages/adapters/opencode/src/parse.ts`：`parseOpenCodeEvent(envelope: { hookName: 'event' | 'tool.before' | 'tool.after', payload: unknown, session_id: string, timestamp: number, git?: GitState })` → `Event[]`。state machine 在 caller（CLI）侧：parser 本身无状态，fire-and-forget 每事件。
    - `session.created` → `session_start`
    - `message.updated` (role=user) → `turn_start`（user message id = turn_id）
    - `message.part.updated` (part.type='tool', state.status='completed') → `tool_call`（input、output、started_at、ended_at 全齐）
    - `message.part.updated` (part.type='reasoning') → 累加到 session-side reasoning buffer（CLI 层）
    - `message.part.updated` (part.type='text', part of assistant message) → 累加到 session-side final-message buffer
    - `message.updated` (role=assistant, time.completed 已填) → `turn_end`（拉 CLI 层 buffer flush）
    - `session.deleted` → `session_end`
    - 其它：返回 `[]`，parser level skip
  - `packages/cli/src/commands/capture-opencode.ts`：stdin 读单条 envelope JSON → `parseOpenCodeEvent` → `sendEvent` 循环。状态（pending reasoning / text buffer、pending tool before_content by callID）存 `<state_dir>/sessions/<session_id>.json`（复用 `session-state.ts`，新增字段）。
  - Plugin 文件（由 install 命令写出）：subscribe `event` + `tool.execute.before` + `tool.execute.after`。每个回调 `spawn('minspect', ['capture-opencode'], {detached, stdio})` + 写 JSON 到 stdin + unref + close。catch all 不重抛（match hook 绝不阻塞的项目 rule）。
  - `packages/cli/src/commands/install.ts`：`--agent opencode` 分支。scope=user 时写 `~/.config/opencode/plugins/minspect.ts`（Windows 下 `%USERPROFILE%\.config\opencode\plugins\`）；scope=project 时写 `.opencode/plugins/minspect.ts`。幂等（BEGIN/END 标记块）+ 备份（`.bak.<ts>`）。
  - Fixture 测试（所有合成，基于 SDK 真实类型）：5 个 parser fixture + 2 个 CLI integration fixture。
- Out:
  - 用 npm 发布 `@minspect/opencode-plugin` 包走 `opencode.json` 的 `plugin` 数组加载路径。第一版用文件 drop-in 避免发包。
  - 自定义 tool 注册（Hook 的 `tool` 字段）。minspect 只观察，不往 OpenCode 塞工具。
  - OpenCode v2 SDK (`sdk/dist/v2/`) 的差异对齐。v1 先支撑主流，v2 相关 Event union 更大一些（多了 project / worktree / pty / permission.ask 等），真有 v2 用户再加卡。
  - MCP / experimental.session.compacting 的业务语义。
  - npm 包形态的 plugin install。

# Acceptance

- [ ] Given 合成 `session.created` event fixture When parser 消费 Then 产 `session_start`，workspace = `info.directory`，git 字段来自 envelope
- [ ] Given 合成 `message.updated` (role=user) fixture When parser 消费 Then 产 `turn_start`，turn_id = message.id，idx 单增
- [ ] Given 合成 `message.part.updated` (tool, state=completed) fixture for Write 工具 When parser 消费 Then 产 `tool_call`，file_edits 从 state.input 抽（file_path + after_content，before_content 来自 side buffer 或 null）
- [ ] Given 合成 `message.part.updated` (reasoning) 后接 `message.updated` (role=assistant, time.completed) Then parser 最后产的 `turn_end` 含聚合好的 agent_reasoning + agent_final_message
- [ ] Given 未知 event.type When parser 消费 Then 返回 `[]`，不抛
- [ ] Given `minspect capture-opencode` 从 stdin 读合法 envelope When collector up Then 事件入库；collector down Then 落磁盘队列
- [ ] Given `minspect install --agent opencode --scope user` When 跑 Then `~/.config/opencode/plugins/minspect.ts` 存在、是合法 TS（import { Plugin } from '@opencode-ai/plugin'），包 BEGIN/END 标记块；二次运行幂等 + `.bak.<ts>` 备份
- [ ] Given 真实 OpenCode session（post-close 人工验证，非 CI）When plugin 装上并 `opencode` 一段会话 Then `minspect serve` 的 /api/sessions 能看到 agent=opencode 的 session + turns + tool_calls
- [ ] All tests green, biome clean, bundle size 未爆（CLI ≤ +20 KB）

# Plan

- [ ] T1 **参考真实 SDK 类型** 写 `packages/adapters/opencode/src/types.ts`（zod schemas，字段 optional 占多数防版本漂移）
  - Expected output: types.ts ≤ 200 行
- [ ] T2 `parseOpenCodeEvent` 实现 + 5 fixtures
  - Expected output: parse.ts + parse.test.ts，6-8 test cases
- [ ] T3 `capture-opencode` CLI 命令（含 session-state 扩展字段 `pending_reasoning: string[]`、`pending_text: string[]`、`pending_before_content: Record<callID, string>`）+ 3 integration tests
- [ ] T4 `install --agent opencode` 分支（user / project scope）+ plugin 文件模板（~50 行 TypeScript）+ 3 tests（首写 / 幂等 / 备份）
- [ ] T5 真机 smoke：手动 `opencode` 跑一段，验证 minspect serve 的 UI 能看到 session。**此步可能暴露 payload 字段漂移**，按需回头修 types.ts / parse.ts。
- [ ] T6 specs/adapters.md OpenCode 段从 "skeleton" 升级到真实实现；specs/cli.md 新增 `capture-opencode` + `install --agent opencode` 条目
- [ ] T7 close，若 T5 有发现 → `Execution notes` 记真机 fixture 差异（和卡 19 pattern 一致）

# Risks and Rollback

- Risk: **plugin SDK 类型可能跨版本变动**。当前验证基于 `@opencode-ai/plugin@1.2.27`。Mitigation: zod schemas 把多数字段标 optional；parser 宽进严出（不匹配直接 skip 返回 `[]`）；install 命令的 plugin 模板里 `import type` 而非运行时依赖具体 SDK 版本。
- Risk: **file edits 的 before_content 抓不全**：built-in `edit` tool 的 input 是 `{file_path, old_string, new_string}` —— old_string 只是片段，不是整文件。Mitigation: `tool.execute.before` 时 `fs.readFileSync(file_path, 'utf8')` 缓存到 side map by callID；after 时 read 一次 after 内容 + match map 取 before。新建文件路径 `fs.readFile` 抛 ENOENT → before_content = null（符合 core 契约）。
- Risk: **streaming `message.part.updated` 高频触发**：每个 token 都可能一次。Mitigation: parser 仅在 TextPart / ReasoningPart 有 `time.end` 时才触发 turn_end 的 flush；中间增量累加到 session-state buffer，不发事件。
- Risk: **OpenCode 进程崩溃导致 session_end 丢失**：`session.deleted` 可能不触发。Mitigation: 和 Claude Code 一样接受"session 可能没有 ended_at"，UI 已处理（`ended_at == null` = in-progress，LiveDot 显示）。
- Risk: **plugin 运行在 Bun 不是 Node**：`child_process.spawn` 在 Bun 里应该兼容但 API 细节可能有差异。Mitigation: 用 `process.platform` 判定命令名（Windows 用 `minspect.cmd`）；spawn 失败静默（catch 后 return）。
- Rollback: parser 恢复 stub 返回 `[]`；CLI 删 `capture-opencode`；install 删 opencode 分支；plugin 文件手动删除（或跑 `install --agent opencode --uninstall`，留给后续）。

# Notes

- **Plugin 模板**（install 写出的文件大致形态，后续 T4 细化）：

  ```ts
  // >>> minspect managed >>>
  import type { Plugin } from '@opencode-ai/plugin';
  import { spawn } from 'node:child_process';

  const MINSPECT_BIN = process.env.MINSPECT_BIN || 'minspect';

  function fireAndForget(payload: unknown) {
    try {
      const ch = spawn(MINSPECT_BIN, ['capture-opencode'], {
        detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
      });
      ch.stdin?.end(JSON.stringify(payload));
      ch.unref();
    } catch { /* hook never blocks */ }
  }

  export const Minspect: Plugin = async (ctx) => ({
    event: async ({ event }) => fireAndForget({ hookName: 'event', payload: event, timestamp: Date.now() }),
    'tool.execute.before': async (input) => fireAndForget({ hookName: 'tool.before', payload: input, timestamp: Date.now() }),
    'tool.execute.after': async (input, output) => fireAndForget({ hookName: 'tool.after', payload: { ...input, output }, timestamp: Date.now() }),
  });
  export default Minspect;
  // <<< minspect managed <<<
  ```

- **OpenCode config 选 project vs user scope**：default user（和用户已有 `~/.config/opencode/opencode.json` 对齐；他已经装了 `oh-my-opencode` 做全局 plugin），`--scope project` 切 `.opencode/plugins/`.

- **`tool.execute.before` 的职责**：只为了 file read before_content。可以在 parser 里把 hookName='tool.before' 处理成纯 side-effect（写 session-state）而不产 Event；parser 返回 `[]`。

- **state machine 放 CLI 层而不是 adapter**：adapter parser 保持纯函数（和 Claude Code / Codex parser 一样）。CLI 的 capture-opencode 负责：读 session-state，累加 reasoning/text 到 buffer，发 Event 时一起 flush。

- **前置依赖已解除**：`@opencode-ai/plugin@1.2.27` 在用户机器可访问，不需要从网络拉 fixture。

- **和 Claude Code hook 安装的异同**：Claude Code 改 `settings.json`（JSON 结构注入）；OpenCode 装 plugin 是写一个 TS 文件（文件粒度注入）。install 命令分支分别处理，共享"BEGIN/END 标记 + 备份 + 幂等"原则。

- 参考资料：[OpenCode Plugin API docs](https://opencode.ai/docs/plugins) + 真实安装的 `dist/index.d.ts` + `@opencode-ai/sdk/dist/gen/types.gen.d.ts`。文档页上列的"Events/Hooks 分类"实际是 Hook 接口的 keys + Event union 的 type 字段混合描述，实装里 Hook 名称（`chat.message` / `tool.execute.before` 等）和 Event.type（`session.created` / `message.updated` 等）是两层机制，本卡按真实类型对齐。

## Execution notes (2026-04-28)

- T1 `types.ts`：zod schemas 按 `@opencode-ai/plugin@1.2.27` + SDK `types.gen.d.ts` 对齐。`OpenCodeParserState` 里拆出 `pending_reasoning` / `pending_final_message` / `before_content_by_call` / `emitted_tool_call_ids` 四块状态。Adapter 新增 `zod ^3.23.8` 依赖。
- T2 `parse.ts`：~300 行 pure reducer + 9 unit tests 覆盖 session.created / turn_start + TextPart 回填 user_prompt / ToolPart 产 tool_call + dedup / tool.before + edit 合成 after_content / reasoning + text 累加 + turn_end flush / session.deleted / 未知 event / malformed envelope / status=error。初版踩了 zod 联合 passthrough 导致 TS 不收敛的坑，handler 参数改收 `properties` 子对象 + `as never` 注解绕过。
- T3 `capture-opencode` CLI：`readOpenCodeState` / `writeOpenCodeState` 文件命名 `opencode-<session_id>.json`（与 Claude Code 的 `<session_id>.json` 同目录但不冲突）。`extractSessionId` 第一版漏了 `properties.part.sessionID` 路径 → 测试失败 → 修回；这是捕获 ToolPart 事件时能接回同一 state 的关键。4 integration tests 含完整 user→tool→assistant 序列。
- T4 `install-opencode`：plugin 模板约 60 行 TS，用 `spawn + unref + JSON stdin` 把 envelope 投给 `capture-opencode`。非 minspect 管理的文件也先备份再覆盖（对齐 Claude Code install 的 safety net）。5 tests，含 Windows 反斜杠转义。
- T5 真机 smoke：**未跑**。此步要求人工启 `opencode` 跑一段会话；card acceptance 不依赖它，合成 fixture + 9 parser test + 4 capture test + 5 install test（总 18 新）已把主路径全链条覆盖。使用 OpenCode 的用户首次跑发现字段漂移可直接修 `types.ts` 的 schema（宽进策略留了余地）。
- 测试统计：246 tests pass（卡 33 结束时 228 + 18 新）；biome clean；所有 7 个包 build 通过。
- Bundle / deps：adapter 新增 zod；CLI 新增 `@minspect/adapter-opencode` workspace 依赖，磁盘上 `dist/` 体积增量 ~15 KB。无 UI 改动，UI bundle 不变。

## Close

- 卡归档到 `minispec/archive/38-adapter-opencode-real.md`。
- `specs/adapters.md` 新增 `## OpenCode` 完整章节（public surface + rules + Changes 子条目），去掉原"卡 15"斜体 placeholder。
- `specs/cli.md` `Commands` + `Public surface` + `Changes` 都加了 OpenCode 条目。
- 下一步（post-close 人工）：用户跑 `minspect install --agent opencode` → 打开 OpenCode 跑一段 → `minspect serve` 打开 UI，确认 session 出现、turn 有 prompt / reasoning / final message / file_edits。若有字段漂移，改 `packages/adapters/opencode/src/types.ts` 的 zod schema。
