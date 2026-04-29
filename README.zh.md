# minspect

[English](README.md) · [中文](README.zh.md)

> 面向 AI 编码代理的 git blame —— 记录每个代理改了什么、为什么改、通过哪条提示改，精确到行。

`minspect` 以本地守护进程方式运行，接入 AI 编码 CLI（Claude Code、Codex CLI、OpenCode），实时捕获每一次编辑。它重建 **会话 → 轮次 → 提示 → 思考 → 片段 → 行** 的归因链，让你能回答：

- "这一行是哪条提示引入的？"
- "代理做这次改动时在想什么？"
- "我即将 push 的 commit 里 AI 改了哪些地方？"

全部本地运行。无云服务、无账号、无遥测。数据保存在状态目录下的单个 SQLite 文件里。

## 状态

已在 Windows、macOS、Linux（Node 20+）上验证通过。工作区 351 个测试，lint 与 build 全绿。

| 代理        | 接入方式                               | 状态                                       |
| ----------- | -------------------------------------- | ------------------------------------------ |
| Claude Code | 原生 hook                              | 完整支持（编辑、思考、commit 关联）        |
| Codex CLI   | 会话日志导入（`rollout-*.jsonl`）      | 完整支持（apply_patch → 行级追溯）         |
| OpenCode    | 插件（`event` / `tool.execute.*`）      | 完整支持（编辑、思考、文件归因）           |

## 快速开始

### 1. 安装

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/ivenlau/minspect/main/scripts/install.sh | sh
```

Windows（PowerShell）：

```powershell
iwr https://raw.githubusercontent.com/ivenlau/minspect/main/scripts/install.ps1 | iex
```

两个脚本都会检查 Node ≥ 20 再执行 `npm install -g minspect`。直接走 npm：

```bash
npm install -g minspect
```

从源码安装：

```bash
pnpm install
pnpm -r build
pnpm -C packages/cli link --global
```

### 2. 运行 `minspect init`

```bash
minspect init
```

它会检测你装了哪些代理、交互式装对应 hook（Claude Code / OpenCode）、按需导入最近 30 天的 Codex 会话、在 git 仓里装 post-commit hook、首次询问是否允许 hook 自动启动守护进程，最后启动 `serve` 并在 `http://127.0.0.1:21477` 打开 UI。加 `--yes` 走非交互。

重复运行 `init` 是安全的——已装项会自动跳过。

### 3. 正常使用 AI

和平时一样用 Claude Code / Codex / OpenCode 对话。每次编辑、工具调用、提示、代理思考都会在后台被记录。

### 4. 回顾

在 Web UI 中：

- **仪表盘** —— 活动柱状图（今天 / 本周 / 最近 30 天 / 最近一年）、热门工作区、主要代理、近期告警
- **时间线** —— 全部工作区的会话按时间倒序
- **会话 → 文件** —— 每文件编辑次数，点击进入追溯
- **追溯** —— 每行按写入它的轮次着色；点击一行可见提示、代理思考、本轮最终回复
- **回顾** —— 会话内所有编辑配 inline diff，按文件 / 关键词 / 级别过滤，可导出为独立 HTML 附给 PR
- **重放** —— 逐步回放工具调用，键盘操作（←/→、Home/End、空格自动播放）
- **回滚** —— 回顾卡片和重放步骤都有"回滚本轮"按钮；弹出预览并生成可复制的 CLI 命令
- **命令面板**（⌘K / Ctrl+K）—— 跨会话 FTS5 搜索提示、思考、工具调用说明、文件路径
- **EN / 中 切换** —— 主题切换按钮旁的完整中文翻译

## 常用命令

```bash
minspect                          # 无参默认 status（守护进程 / 队列 / 最近事件 / hook）
minspect init                     # 一次性安装（可重复运行）
minspect serve                    # 启动守护进程 + UI（端口 21477）
minspect stop                     # 停止守护进程
minspect doctor                   # 8 项诊断
minspect uninstall --all --yes    # 对称 install（加 --purge 清状态数据）
minspect import-codex --latest    # 手动导入一次 Codex 会话
```

## 回滚 AI 改动

`minspect` 保存了每次改动的前后快照，可以把文件还原到某一轮次或某次编辑之前的状态：

```bash
# 先 dry-run，看看会改什么
minspect revert --turn <turn_id>

# 真正写盘
minspect revert --turn <turn_id> --yes

# 回滚单次编辑（单文件）
minspect revert --edit <edit_id> --yes

# 强制覆盖 drift 检查（确认磁盘上的文件已被人工修改时才用）
minspect revert --turn <turn_id> --yes --force
```

安全保障：
- **默认 dry-run**：必须加 `--yes` 才写盘。
- **Drift 检测**：若磁盘当前文件 sha256 与记录中的 after_hash 不一致，默认拒绝回滚（`--force` 可覆盖）。
- **Codex 硬拒**：Codex 导入的会话禁止回滚——其 patch 日志只记录 hunk 窗口，不是完整文件，回滚会覆盖无关区域。请用 `git checkout`。
- **链断警告**：若目标与当前磁盘状态之间检测到用户编辑，会先列出来让你确认。
- **服务端只读**：collector 绝不写你的工作区。唯一写盘路径是 CLI。

UI 的回顾 / 重放页也有"回滚本轮"按钮，弹出预览并生成可复制的 CLI 命令。

## 导入既有 Codex 会话

Codex 没有 hook API，日志只能事后导入：

```bash
# 最新会话
minspect import-codex --latest

# 指定路径或 UUID
minspect import-codex --session rollout-2026-02-26T16-22-56-019c990b-3d80-73a0-baa0-ebd4b1c3f87d.jsonl
minspect import-codex --session 019c990b

# 批量导入最近 30 天（侧边栏刷新按钮和每小时后台任务走 --since 1d 的这条路径）
minspect import-codex --all --since 30d
```

重复导入是幂等的——Codex 自己的 UUID 直接作为稳定主键。

## 运作机制

```
┌─ 代理（Claude Code / Codex CLI / OpenCode）
│     │  hook 触发  ─或─  写会话日志
│     ▼
├─ `minspect capture`（短生命周期，≤100 ms 退出，绝不阻塞代理）
│     │  POST Event  ─或─  守护进程不在时落盘
│     ▼
├─ Collector 守护进程（Fastify + SQLite + WAL，默认端口 21477）
│     │  单事务写入
│     ▼
├─ 索引器
│     ├─ structuredPatch diff → hunks
│     ├─ 行级追溯传播（hash 链，用户编辑处断开）
│     ├─ tree-sitter AST（TS/JS/Python/Go/Rust/Java）用于方法级聚合
│     └─ post-commit hook → commit_links
│     ▼
└─ Web UI（React + Vite SPA，打包进守护进程）
```

核心设计：

- **hook 绝不阻塞代理**：任何异常 → 写 stderr → `exit 0`；网络失败则事件入磁盘队列，下次 hook 触发时先 drain。
- **写入幂等**：所有 INSERT 使用 `ON CONFLICT DO NOTHING`，ID 确定性生成（`edit_id = ${tool_call_id}:${idx}`），磁盘队列重放安全。
- **代理思考源自代理本身**：从 Claude Code transcript 的"I'll edit X because …"前言（或 Codex 的 `agent_reasoning` 事件）直接提取。**不额外调 LLM，不需要 API key。** 独立 LLM explainer 保留为不具备思考输出的代理的可选后备。
- **追溯链干净断开**：若编辑 N+1 的 `before_hash` 与编辑 N 的 `after_hash` 不一致，链重置而不是把你的改动误归给 AI。

## 仓库结构

```
packages/
├── core/                 — 事件 schema（zod）、DB schema、migrations、git 辅助
├── collector/            — Fastify 服务、SQLite 存储、追溯 + AST 索引器、
│                           LLM explainer（可选）、Claude-Code transcript 解析
├── cli/                  — `minspect` 二进制：init、status、serve、stop、doctor、
│                           capture、capture-opencode、install、uninstall、
│                           import-codex、link-commit、revert、vacuum
├── ui/                   — React + Vite SPA（深/浅色主题、EN/中 i18n），
│                           构建产物打包进 collector
└── adapters/
    ├── claude-code/      — hook payload → Event；transcript 思考提取
    ├── codex/            — rollout-*.jsonl 解析 + apply_patch → file_edits
    ├── opencode/         — 插件 envelope → Event（edit / write / reasoning）
    └── aider/            — 骨架（预留）
```

## 脚本

```bash
pnpm build      # 全包 tsc
pnpm test       # 全包 vitest（约 351 个测试）
pnpm lint       # biome check .
pnpm format     # biome format --write .
```

注：biome 的 `format` 不会整理 import 顺序。新增或移动 import 后请跑 `pnpm exec biome check --write .`。

## 数据与隐私

- SQLite 文件：`<state_dir>/history.sqlite`（WAL 模式）
- 状态目录：`%LOCALAPPDATA%\minspect`（Windows）或 `$XDG_STATE_HOME/minspect`（Linux/macOS，默认 `~/.local/state/minspect`）
- 守护进程状态：`<state_dir>/state.json` —— port / pid / started_at / spawned_by
- 每会话状态：`<state_dir>/sessions/<session_id>.json` —— 轮次计数、编辑前文件快照
- 磁盘队列（守护进程离线时）：`<state_dir>/queue/<timestamp>-<uuid>.json`
- 用户配置：`<state_dir>/config.json` —— 目前仅 `auto_spawn_daemon`

清空所有历史：`minspect uninstall --all --purge --yes`（或停守护进程后手动删 `<state_dir>`）。

数据绝不离开你的机器——除非你显式开启 LLM explainer（`config.explainer.enabled = true`），此时 hunks 会用你自己的 key 发往 Anthropic API。

## 排查问题

如果 UI 里没 session、hook 没触发等：

```bash
minspect doctor
```

输出 8 项检查（Node 版本、状态目录、守护进程、已装 hook、DB、最近活动），每项 ✓/⚠/✗ 并在非 ok 项旁给出 `fix:` 建议。`--json` 机器可读。只有 `✗` 硬失败才退出非零，CI 友好。

## 卸载

```bash
# 先 dry-run 看将要删除的内容
minspect uninstall --all

# 真正应用：撤 Claude Code + OpenCode hook、停守护进程、撤当前仓的 post-commit hook
minspect uninstall --all --yes

# 额外清掉 SQLite DB 和已捕获的会话（不可恢复）
minspect uninstall --all --purge --yes
```

`uninstall` 与 `install` 对称：只动它自己写入的标记块（Claude Code 的 `__minspect_managed__: true`、OpenCode 和 post-commit 的 `// >>> minspect managed >>>` 标记）。围绕这些块的用户 hook 一律保留，每个被修改的文件都写 `.bak.<timestamp>` 备份。

## 已知限制

- **Codex 的 patch 行号是 hunk 相对的，不是绝对的**：Codex 的 `apply_patch` 格式不含完整文件内容，被 Codex 编辑过的文件行级追溯是相对于改动区域的。升级路径见 `minispec/specs/adapters.md`。
- **合并 commit 不被关联**：`link-commit` 跳过 `parent_count > 1` 的 commit。
- **AST 覆盖 6 种语言**：TypeScript、JavaScript、Python、Go、Rust、Java。其它扩展名回退到整文件节点。
- **Inline diff 用文本 `<pre>` 渲染**（暂无 Monaco / 语法高亮）。

## 开发

改动走轻量 spec 工作流（`minispec`）：

1. 在 `minispec/changes/` 开 change card
2. 应用 + 测试 + 勾选 acceptance
3. 关卡 → 规则合并进 `minispec/specs/<domain>.md`，归档 card

完整约定见 `CLAUDE.md`。规范文档：

- [foundation.md](minispec/specs/foundation.md) —— monorepo、工具链
- [core.md](minispec/specs/core.md) —— Event schema、DB schema
- [collector.md](minispec/specs/collector.md) —— 服务、写入管线、追溯/AST
- [adapters.md](minispec/specs/adapters.md) —— 各代理解析规则
- [cli.md](minispec/specs/cli.md) —— CLI 命令与 hook 协议
- [ui.md](minispec/specs/ui.md) —— 路由、API 契约

原始产品设计文档：[`design.md`](design.md)。

## License

MIT。仓库地址：[github.com/ivenlau/minspect](https://github.com/ivenlau/minspect)。
