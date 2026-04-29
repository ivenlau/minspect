# AI Coding History — 设计文档

> AI coding agent 辅助产品：动态记录 agent 对代码库的改动，提供文件/方法/行级别的多维历史视图，让用户知道 AI 改了什么、为什么改、改的过程。

---

## 1. 产品定位

### 1.1 要解决的问题

开发者使用 Claude Code / Codex / OpenCode / Cursor / Aider 等 AI coding agent 时，丢失了关键信息：

- Git 只记录了代码的**最终形态**
- Chat log 只记录了**对话**
- 但**"这行代码来自哪次对话的哪一轮、agent 为什么这么写、中间迭代了几次"**——没有工具把这条线索拼起来

### 1.2 目标用户

| 用户画像 | 核心问题 |
|---|---|
| 写完代码做自我 review 的开发者 | "AI 刚才到底干了啥，有没有偷偷改了不该改的" |
| 做代码审查的 tech leader | "这个 PR 里 AI 的产出靠谱吗，是否按 prompt 意图实现" |

MVP 先服务**自我 review 场景**（无需任何团队基础设施即可产生价值），tech lead review 视图在 Phase 2 做。

### 1.3 核心差异化

护城河不在"采集"（每个 agent 写 adapter 即可），而在**归因**：

> 同一行代码经过 N 轮对话的演化，能准确告诉用户每一轮干了什么、为什么。

即"AI 版 blame"——git blame 只追到 commit，本产品追到 **session → turn → prompt → agent reasoning → hunk**。

---

## 2. 关键决策（已定）

| 决策项 | 选择 | 备注 |
|---|---|---|
| 产品形态 | MCP Server / Agent Hook 采集 + 本地 Web UI 展示 | 后续扩展 IDE 插件作为展示层 |
| 服务对象 | 单用户，本地优先 | 不做团队 / 云同步（至少 MVP 不做） |
| Agent 覆盖 | 通用层，主流 agent 都接 | 优先级：Claude Code → Codex → OpenCode → Aider |
| 用户画像 | 自我 review 开发者 + tech leader review | MVP 先做前者 |
| "为什么"粒度 | **B 方案**：事后调 LLM 解释每个 hunk | BYO API key；可关 |
| Git 感知 | **是**：每条记录绑定 branch / HEAD / dirty | 用户 commit 后关联 edit ↔ commit |
| 时效 | **实时采集** | Hook 在 agent 每次 edit 时即写入 |

---

## 3. 架构总览

```
┌─ Agent Adapters（按 agent 各写一个）
│   ├─ Claude Code → 原生 hooks（PreToolUse/PostToolUse/Stop/UserPromptSubmit/SessionStart）
│   ├─ Codex CLI   → wrapper 或 session log 解析
│   ├─ OpenCode    → plugin 机制
│   └─ Aider       → chat history + git log 反推
│        ↓ 发送标准化事件
├─ Collector（本地常驻 daemon，HTTP / Unix Socket）
│        ↓ 落盘
├─ Store：SQLite（+ 后续 sqlite-vec 做 prompt 语义搜索）
│        ↓
├─ Indexer
│   ├─ tree-sitter AST 解析 → 行级归属到方法/类
│   ├─ 行血缘追踪（edit 之间的 line lineage）
│   ├─ LLM Explainer（异步 hunk 解释队列）
│   └─ Git commit 事后关联
│        ↓
└─ Web UI（localhost，Monaco 编辑器做行内装饰）
    ├─ Timeline view
    ├─ AI Blame view
    └─ Review view（Phase 2）
```

### 3.1 为什么是 Daemon + Hook

- Hook 进程必须**快进快出**——Claude Code 会等它，阻塞则卡 agent
- 所以 hook 只做"捞 git 状态 + 读文件 + POST 事件"，重活（AST 解析、LLM 解释、blame 重算）全在 daemon 里做

---

## 4. 数据模型（SQLite Schema）

```sql
-- 工作区（通常 = git repo 根）
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  git_remote TEXT,
  created_at INTEGER NOT NULL
);

-- 一次 agent 会话
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                  -- 用 agent 自己的 session id
  workspace_id TEXT NOT NULL,
  agent TEXT NOT NULL,                  -- 'claude-code'|'codex'|...
  agent_version TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  git_branch_start TEXT,
  git_head_start TEXT
);

-- 一轮对话（user prompt + agent response）
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  user_prompt TEXT NOT NULL,
  agent_reasoning TEXT,                 -- thinking block（如果能拿到）
  agent_final_message TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  git_head TEXT,                        -- 本轮开始时 HEAD
  UNIQUE(session_id, idx)
);

-- 工具调用（Edit/Write/MultiEdit/Bash/...）
CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  status TEXT,                          -- ok|error|denied
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

-- 文件级 edit（一次 tool call 可能涉及多个文件，如 MultiEdit）
CREATE TABLE edits (
  id TEXT PRIMARY KEY,
  tool_call_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,                -- 反范式，查询用
  session_id TEXT NOT NULL,             -- 反范式
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,              -- 相对 workspace
  before_hash TEXT,                     -- null = 新文件
  after_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  git_head TEXT
);

-- 文件内容（内容寻址，去重）
CREATE TABLE blobs (
  hash TEXT PRIMARY KEY,                -- sha256
  content BLOB NOT NULL
);

-- Hunk = 行级 diff + LLM 解释
CREATE TABLE hunks (
  id TEXT PRIMARY KEY,
  edit_id TEXT NOT NULL,
  old_start INTEGER,
  old_count INTEGER NOT NULL,
  new_start INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  old_text TEXT,
  new_text TEXT,
  explanation TEXT,                     -- LLM 异步回填
  explanation_model TEXT,
  explained_at INTEGER
);

-- 行血缘（AI Blame 核心表）
-- 每次 edit 后重算当前文件每行归属到哪个 edit/turn
CREATE TABLE line_blame (
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  content_hash TEXT NOT NULL,           -- 用户手改后失效
  edit_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, file_path, line_no)
);

-- AST 节点（tree-sitter 解析）
CREATE TABLE ast_nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- function|class|method|...
  qualified_name TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  last_computed_at INTEGER NOT NULL
);

CREATE TABLE edit_ast_impact (
  edit_id TEXT NOT NULL,
  ast_node_id TEXT NOT NULL,
  PRIMARY KEY (edit_id, ast_node_id)
);

-- 提交关联（事后补）：用户 commit 后，把包含的 edit 挂到 commit
CREATE TABLE commit_links (
  commit_sha TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  edit_id TEXT NOT NULL,
  PRIMARY KEY (commit_sha, edit_id)
);

CREATE INDEX idx_edits_file ON edits(workspace_id, file_path, created_at);
CREATE INDEX idx_edits_session ON edits(session_id, created_at);
CREATE INDEX idx_blame_file ON line_blame(workspace_id, file_path);
```

### 4.1 设计要点

- **blobs 内容寻址**：避免每次 edit 存两份全文，只存 hash 引用，大幅节省空间
- **line_blame.content_hash**：判断这行是否还是当时的内容；用户手改过则 blame 条目失效，归属降级到"未知/用户修改"
- **commit_links**：git 感知靠这张表——`post-commit` git hook 触发一次对账

---

## 5. Claude Code Hook 接入（首个 Adapter）

### 5.1 Hook 配置

写入 `~/.claude/settings.json`（全局）或项目 `.claude/settings.json`：

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "minspect capture --event session_start" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "minspect capture --event prompt_submit" }] }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "minspect capture --event pre_tool" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|Bash",
        "hooks": [{ "type": "command", "command": "minspect capture --event post_tool" }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "minspect capture --event stop" }] }
    ]
  }
}
```

### 5.2 `minspect capture` 行为

1. 从 stdin 读 hook payload（JSON，含 session_id、tool_name、tool_input 等）
2. 捞 git 状态：`git rev-parse HEAD` / `git branch --show-current` / dirty 标记
3. 对 Edit/Write 型工具：
   - `pre_tool` 时读原文件内容存 blob
   - `post_tool` 时读新内容，生成 hunks
4. 通过 Unix Socket / localhost HTTP 推给常驻 collector（非阻塞，失败落本地磁盘队列兜底）
5. 立刻退出（**hook 必须快**）

### 5.3 Reasoning 回填

Claude Code 的 thinking block 在 `Stop` hook 时可从 transcript 路径读到完整消息历史。adapter 做一次后处理，把 reasoning 回填到对应 turn。

### 5.4 Git Commit 关联

在项目的 `.git/hooks/post-commit` 里挂一个 `minspect link-commit`：
- 读 `git diff HEAD~1 HEAD --name-only`
- 查最近时间窗内的 edits
- 写 `commit_links` 表

### 5.5 平台注意

**Windows**：hook command 里别写 shell 专属语法，直接调 `minspect.exe` 二进制。

---

## 6. 标准化事件模型

所有 adapter 最后都吐这个形状（跨 agent 统一）：

```ts
type Event =
  | { type: 'session_start'; session_id: string; agent: string; agent_version?: string;
      workspace: string; git: GitState; timestamp: number; }
  | { type: 'turn_start'; session_id: string; turn_id: string; idx: number;
      user_prompt: string; git: GitState; timestamp: number; }
  | { type: 'tool_call'; session_id: string; turn_id: string; tool_call_id: string;
      idx: number; tool_name: string; input: unknown; output?: unknown;
      status: 'ok' | 'error' | 'denied';
      // 仅 edit 类工具填
      file_edits?: Array<{
        file_path: string;
        before_content: string | null;   // null = 新文件
        after_content: string;
      }>;
      started_at: number; ended_at: number; }
  | { type: 'turn_end'; turn_id: string; agent_reasoning?: string;
      agent_final_message?: string; timestamp: number; }
  | { type: 'session_end'; session_id: string; timestamp: number; };

interface GitState { branch: string; head: string; dirty: boolean; }
```

**原则**：reasoning 能拿就拿、不强制。各 agent 暴露什么就存什么，不要求完全对齐。

---

## 7. 模块拆分

```
minspect/
├── packages/
│   ├── core/               # 共享类型 + schema.sql
│   │   ├── types.ts        # Event / Session / Turn / Edit / ...
│   │   └── schema.sql
│   │
│   ├── collector/          # 常驻 daemon
│   │   ├── server.ts       # 接事件的 HTTP / Unix socket server
│   │   ├── store.ts        # SQLite 写入
│   │   ├── blame.ts        # line lineage 重算
│   │   ├── ast.ts          # tree-sitter 封装
│   │   ├── explainer.ts    # LLM 解释队列 worker
│   │   └── git.ts          # git 状态读取 + commit 关联
│   │
│   ├── cli/                # `minspect` 命令
│   │   ├── serve.ts        # 起 daemon + UI
│   │   ├── capture.ts      # hook 入口（快进快出）
│   │   └── install.ts      # 一键把 hook 配置写进各 agent
│   │
│   ├── adapters/
│   │   ├── claude-code/    # hook payload → Event
│   │   ├── codex/          # CLI wrap / session log 解析
│   │   └── opencode/       # plugin
│   │
│   └── ui/                 # React + Monaco
│       ├── timeline.tsx    # 时间轴视图
│       ├── blame.tsx       # AI Blame 视图
│       └── review.tsx      # 按 prompt 分组（Phase 2）
```

### 7.1 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| Collector/Indexer | TypeScript / Node | MVP 快速出活，后续性能瓶颈再换 Go/Rust |
| 存储 | SQLite | 单用户本地场景完全够；后续加 `sqlite-vec` 做 prompt 语义搜索 |
| AST | tree-sitter | 跨语言通吃 |
| 前端 | React + Monaco Editor | 天然支持行内装饰与悬浮卡片 |

---

## 8. LLM Explainer（B 方案）

### 8.1 架构

- 写 edit 时**不直接调 LLM**，而是把 hunk id 塞进 `explain_queue` 表
- Explainer 是 collector 内的 worker，**串行**消费队列（避免并发打爆 API）
- 按 hunk 内容 hash **缓存**（同样的 diff 不重复解释）

### 8.2 Prompt 模板

```
本轮 user_prompt:
<prompt 全文>

本轮前序工具调用摘要:
<最近 3 个 tool call 的 name + 简要>

这个 hunk 改动了 <file_path>:<line_range>:
<unified diff>

请用一句话说明：这个具体 hunk 为什么这么改？
```

### 8.3 默认模型与成本控制

- **默认模型**：Claude Haiku 4.5（便宜、快、对 diff 理解足够）
- 可配置换成本地 ollama 或任意 OpenAI 兼容端点
- **BYO API key**，不替用户出钱
- Hunk 超过 N 行（如 200）截断
- 配置里提供关闭开关——重视觉的用户可以只要 blame、不要 explain

---

## 9. MVP 落地路径

### Phase 1（第一周，最小可用）

- ✅ Claude Code adapter（hooks 最成熟、数据最全）
- ✅ SQLite 存储 + 本地 HTTP collector
- ✅ 一个视图：**AI Blame**——打开任意文件，每行右侧标注来自哪次对话的哪轮 turn，点开看 prompt
- ✅ `minspect serve` 一键启动 daemon + UI

### Phase 2

- Codex adapter
- tree-sitter 方法级聚合（"这个函数经历了 3 次迭代"）
- **Review 视图**：按 session / prompt 分组展示所有改动
- LLM Explainer 上线

### Phase 3

- OpenCode、Aider adapter
- Review 视图加风险信号：
  - AI 同时改了代码 + 测试
  - 静默新增依赖
  - 修改了安全敏感文件
- Turn 级"重放"功能（像 debugger 一样步进 agent 的每一步）

---

## 10. 开发顺序建议

1. `core` + `collector`：schema、store、HTTP 接收跑通（假数据先测）
2. `cli capture` + Claude Code adapter：在 Claude Code 里打真实一轮对话，验证数据落盘
3. `blame.ts` 行血缘算法（**最容易出 bug 的一块**——edit 之间行号漂移、用户手改如何失效）
4. UI 的 blame 视图跑通
5. LLM Explainer 接入

---

## 11. 开放问题 / 后续再定

- **多 workspace 管理**：用户同时在多个 repo 里用 agent，UI 如何切换？
- **数据保留策略**：session 多了 SQLite 膨胀怎么办？默认保留多久？
- **导出能力**：tech lead review 场景需要把某个 session 导出给别人看，格式？（HTML/JSON/内嵌 web 包）
- **隐私**：hunk 发给 LLM 解释涉及代码外泄，是否需要"敏感文件黑名单"配置？
- **与现有 `/review` 类工具的关系**：是否提供 CLI 子命令让 `minspect review --since <commit>` 直接出报告？
