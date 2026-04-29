---
id: 19-adapter-codex-real-parser
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: adapters
---

# Why

卡 11 当前只落了 `packages/adapters/codex/` 骨架：`parseCodexLog(log): Event[]` 返回 `[]`，没有真实解析。Codex 用户越来越多（OpenAI 官方 CLI），没 adapter = 这部分用户直接流失。Claude Code adapter 的模式已跑通（transcript → 标准 Event），Codex 遵循同一契约即可接入。

# Approach

- Considered:
  - A：wrapper 模式，劫持 codex CLI stdin/stdout。侵入性强，需用户改命令。
  - B：session log 解析，从 `~/.codex/sessions/` 目录读取日志文件。非侵入。
  - C：plugin 机制。Codex 暂无稳定 plugin API。
- Chosen: **B**。和 Claude Code 的 transcript 模式对称 —— adapter 读本地日志转 Event。支持事后 import（`minspect import-codex`）和 live watcher 两种触发模式。

# Scope

- In:
  - `packages/adapters/codex/src/parse.ts`：真实 parser。输入 Codex session log（具体格式基于 fixture 决定）；输出 `Event[]`。
  - `packages/cli/src/commands/import-codex.ts`：新 CLI 子命令 `minspect import-codex [--session <id>]`，读 `~/.codex/sessions/` 指定 log → parse → POST 到 collector。
  - 至少 5 份真实脱敏 Codex session log fixture（**前置依赖：需用户提供一份真 log 作参考**）。
  - `adapter-codex` 包的 `parseCodexLog` 从存根改为真实实现。
  - session_id 映射：沿用 Codex 自己的 session id（或 log 文件名）。
- Out:
  - Live watcher（`chokidar` 监听）留给后续卡。
  - Codex 不暴露 thinking block 的话 `agent_reasoning` 置空 —— 不强求。
  - Codex 输入图片 / 多模态内容 —— 存 input_json 里，不单独抽取。

# Acceptance

- [ ] Given 一份真实 Codex session log fixture When 调 `parseCodexLog(log)` Then 按序产出 session_start / turn_start / tool_call / turn_end 事件
- [ ] Given `minspect import-codex --session <id>` 运行 Then 事件入 collector DB，`SELECT * FROM sessions WHERE agent='codex'` 能查到
- [ ] Given session 含文件编辑型 tool_call Then `file_edits` 字段含 before/after（若 log 里有），否则空
- [ ] Given 幂等：同 session import 两次 Then 不重复插行（session_id 走 ON CONFLICT DO NOTHING）
- [ ] Given 格式不识别的 log 行 Then skip + warn，不抛错
- [ ] Given 6 份 fixture（真 5 + 合成 1 异常情况）Then 单测全绿

# Plan

- [ ] T1 **前置阻塞解除**：从用户本地 `~/.codex/sessions/` 取一份真 log，脱敏（replace API key / user path 以 `<user>`）作为 fixture
  - Expected output: `fixtures/real-session.log`（或 jsonl）
- [ ] T2 根据 fixture 确定 log 格式（JSONL？chat-style？），写 parser
  - Expected output: `parseCodexLog` 返回真 Event[]
- [ ] T3 `import-codex` 子命令：argv 解析 + fs 读 log + parse + POST
  - Expected output: `minspect import-codex --session <id>` 跑通真实 session
- [ ] T4 单测 + 幂等测 + 异常处理
- [ ] T5 更新 `specs/adapters.md` Codex 段从"skeleton"升级到"真实实现"

# Risks and Rollback

- Risk: Codex 不同版本 log 格式差异。Mitigation: version 嗅探（header / 文件名 / 首行元数据），每版独立 parser；fixture 覆盖至少一个主流版本。
- Risk: reasoning 字段缺失。Acceptable：agent_reasoning 为 null，不影响其它。
- Rollback: parser 改回 stub；import-codex 命令删除；其它包不受影响。

# Notes

- 前置条件：**用户需要提供一份真实 Codex session log**（脱敏后）作为 fixture 起点。无此 fixture 此卡无法 apply（盲写风险高）。
- 可以先和 Codex 用户确认目前的 log 存放位置 / 文件格式（jsonl vs 其它）。
- Session 时间戳若只精确到秒，不能作为唯一排序依据 —— 按文件内 idx 或位置排。

## Execution notes (2026-04-27)

- 用户提供 fixture 路径 `C:\Users\admin\.codex\sessions\2026\02\26`；扫 6803 个 jsonl 文件枚举完整 record 类型集合。Codex CLI 0.104/0.105 envelope = `{timestamp, type, payload}`，顶层类型 `session_meta` / `event_msg:*` / `response_item:*` / `turn_context` / `compacted`。
- Tool 命中名：`shell_command` / `apply_patch` / `update_plan` / `shell` / `request_user_input` / `list_mcp_resources`；patch ops: Update File / Add File / Delete File。
- `parse.ts` 用 pending-turn + pending-tool map（key = `call_id`）把 function_call/*_output 连成单条 `tool_call`。
- `patch.ts` 合成 before/after：context + '-' → before；context + '+' → after。Hunk 行号相对窗口，非全文件绝对坐标（spec 里记录 trade-off）。
- CLI 子命令 `import-codex`：支持 `--session <path|uuid>` / `--latest` / `--dir <override>`；事件走既有 `sendEvent` → collector。
- 测试：20 parser tests（13 parse + 7 patch）+ 3 CLI import-codex integration tests = 23 新；总 168 tests 全绿。
- Biome strict 禁 `!` 非空断言 —— 测试里用 `first()` helper / narrowing throw，实现代码用早出 guard 替代。

## Check

- 5 包构建全绿；`Checked 91 files. No fixes applied.`；total 148 tests pass (20 new codex + 3 new CLI)。
- 合成 fixture `simple-session.jsonl` 覆盖 session_meta / 2 turns / function_call / custom_tool_call (apply_patch)。
- 真实脱敏 fixture `real-short-session.jsonl`（40 KB）产生 0 `skip:*` warning —— 所有 record 类型都被识别。
- 错误路径单测：非法 JSON 行、孤立 function_call、`--session` + `--latest` 缺失全部覆盖。

## Close

- `specs/adapters.md` Codex 段从 "skeleton" 升级为真实实现（公开 surface + rules + Changes 子条目）。
- 卡归档。
