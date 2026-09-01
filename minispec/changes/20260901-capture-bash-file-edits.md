---
id: 20260901-capture-bash-file-edits
status: draft
owner: claude
---

# Why

用户报告：新版 Claude Code 在 auto mode 下执行的操作 minspect 没有记录。DB 取证（2026-09-01，`history.sqlite`）：

- treasury 会话 `fd296f1b`（1.1MB 转录）：turns=7、tool_calls=77（全是 Bash）、**edits=0**。转录里没有任何 Edit/Write/MultiEdit 调用——571 行 Java 测试文件是通过 **Bash heredoc（`cat > file`）** 写入并提交的。
- 对照 mico 会话 `35c39e80`：Bash×18 + Write×1 → tool_calls 19、edits=1（正是那次 Write 的 reply.md）。

根因：capture 只把 `FILE_EDITING_TOOLS`（Edit/Write/MultiEdit）的调用当作文件编辑（`capture.ts:affectedFilePaths`）。auto mode 下 agent 改用 Bash（heredoc / sed -i / tee / git apply）写文件，tool_call 有记录但**文件变更完全不可见**——minspect 的核心价值（"记录 agent 改了什么"）在这类会话里失效。

次要问题：用户 `~/.claude/settings.json` 里每个事件挂了**两份** minspect hook（一份带 `__minspect_managed__` 标记、一份是旧格式无标记的）；`stripOurBlocks` 只按标记剥离，无标记的旧块永远清不掉——每个工具调用 capture 跑两遍（事件重复、idx 翻倍）。

# Approach

- Considered:
  - Option A: 把 Bash 加入 `FILE_EDITING_TOOLS`。trade-off: Bash 的 tool_input 是 shell 命令文本，拿不到 file_path，无从构造 file_edits；不可行。
  - Option B: **git worktree 快照 diff**——session 状态里维护「上次快照」（`git status --porcelain` 状态表 + dirty/untracked 文件内容缓存），PostToolUse(Bash) 时 diff 出本次调用改变的路径，before 从快照内容 / `git show :path`（干净文件的 index 版本）/ null（新建文件）取，after 读磁盘。trade-off: 只覆盖 git 仓；依赖 `git status`（每次 tool call 一次子进程，~10ms，满足 hook ≤100ms SLA）。**Chosen**。
  - Option C: 解析 Bash 命令文本推断被改文件（grep heredoc/sed 模式）。trade-off: shell 语义无法可靠解析（重定向、管道、变量），误报漏报都高。
- Chosen: Option B + hook 去重（stripOurBlocks 增加按 command 归一化匹配，无标记的旧块也能清掉）。

# Scope

- In:
  - `packages/cli/src/bash-edits.ts`（新）：`snapshotWorktree(cwd)`（status 表 + 内容缓存，cap：≤400 路径 / ≤12MB）、`diffWorktree(before, after)`、`gitShowIndex(cwd, path)`。porcelain 用 `-c core.quotepath=false` + `-C <repo root>`，file_path 落库为仓库根绝对路径。
  - `packages/cli/src/session-state.ts`：SessionState 增加 `bash_snapshot?: { status; contents } | null`。
  - `packages/cli/src/commands/capture.ts`：SessionStart 拍快照；PostToolUse(Bash) diff → file_edits（before===after 跳过；删除跳过——v1 不记 rm）；**每次 PostToolUse 后刷新快照**（file 工具路径的内容复用 file_edits 的 after，Bash 路径读盘）；PostToolUse(Bash) 时若无快照（首次/丢失）只记录 tool_call 并补拍，不产生批量误报。非 git cwd 不做 diff。
  - `packages/cli/src/commands/install.ts`：`stripOurBlocks` 同时剥离「command 含 `capture --event `」的无标记旧块。
  - 测试：`capture.test.ts`（临时 git 仓模拟 heredoc 写文件/新建/无变化/删除/非 git）、`install.test.ts`（旧格式去重）。
  - `minispec/specs/cli.md`（close 时）：Bash 编辑归因语义 + 已知限制。
- Out:
  - 非 git 工作区的 Bash 编辑归因（无 diff 基线，v1 不做）。
  - 文件删除（Bash rm）的 edits 记录（after=null 会破坏现有 revert/created 语义，v1 跳过并记录 limitation）。
  - dirty→dirty 且内容缓存溢出（>cap）的路径：before 回退 index 版本（对用户 WIP 未暂存改动有基线偏差，文档记录）。
  - OpenCode / Codex adapters 的同类问题（本次只动 claude-code 链路）。
  - 不新增依赖。

# Acceptance

- [ ] Given 临时 git 仓中 PostToolUse(Bash, `cat > new.java`)，When capture，Then 产出 tool_call + file_edits（before=null → creation 语义），collector 侧可落 edits 行。
- [ ] Given 已被上一轮 Bash 修改过的文件再次被 Bash 修改，When capture，Then before = 上一轮 after（内容缓存，精确）。
- [ ] Given 干净 tracked 文件被 Bash 改写，When capture，Then before = `git show :path`（index 版本）。
- [ ] Given Bash 执行无文件变化的命令，When capture，Then 不产生 file_edits（before===after 或 status 无变化）。
- [ ] Given 非git 目录的 Bash PostToolUse，When capture，Then 只有 tool_call、无 file_edits、无异常。
- [ ] Given settings.json 中同事件挂了带标记 + 无标记两份 minspect hook，When `install --agent claude-code`，Then 重写后每个事件只剩一份。
- [ ] `pnpm -r test` 全绿（Windows）；`pnpm lint` touched files 0 error。
- [ ] 真机：`minspect install --agent claude-code --scope user` 后 settings.json 无重复块；合成 heredoc payload 走真实 `minspect capture` 能在 DB 落 edits 行。

# Plan

- [ ] T1 写 change card（本文件）
- [ ] T2 `bash-edits.ts` 快照/diff/show 助手 + cap
- [ ] T3 session-state 加 `bash_snapshot`；capture.ts 接线（SessionStart / PostToolUse）
- [ ] T4 install.ts 去重 + install.test.ts 用例
- [ ] T5 capture.test.ts 新场景
- [ ] T6 `pnpm -r test` / lint / build
- [ ] T7 真机验证（去重重装 + 合成 payload 端到端）
- [ ] T8 close：更新 `minispec/specs/cli.md`，卡片归档

# Risks and Rollback

- Risk: `git status`/`git show` 在超大仓或机械盘上慢，逼近 hook 100ms SLA。
  - 缓解: `--porcelain` 输出小；只有 dirty/untracked 路径读内容且有 cap；超时影响的是 hook 进程自身（fire-and-forget，Claude Code 对慢 hook 有 timeout，最坏丢事件不阻塞 agent）。
- Risk: 会话状态文件膨胀（内容缓存）。
  - 缓解: cap 400 路径 / 12MB；溢出路径 before 回退 index 版本。
- Risk: Bash 调用里执行 `git add/commit` 改变 index → `git show :path` 基线漂移。
  - 缓解: commit 后的 diff 基于快照 status，index 漂移只影响 clean-before 回退路径的 before 精度；文档记录。
- Risk: 用例依赖旧行为（Bash 不产生 file_edits）。
  - 缓解: 全量套件验证；`capture.test.ts` 现有用例走 Edit/Write 路径，不受影响。
- Rollback: 全部改动限于 CLI capture 链路 + install 去重 + 测试；revert 即回到「Bash 不归因」现状。已去重的 settings.json 无需回滚（单份 hook 本来就是期望形态）。

# Notes

- 取证数据：转录 `/c/Users/admin/.claude/projects/D--ProjectCode-gf-treasury-settlement/fd296f1b-*.jsonl` 工具分布 Bash×92 / ToolSearch×22 / TaskUpdate×8 / TaskCreate×4 / mcp×1，零文件编辑工具；提交 3da4865（571 行 Java 测试）由 `cat >` heredoc 写入。mico 会话 Write 调用正常落 edits，证明 Edit/Write 链路无恙。
- 双份 hook 的来源：旧版 install 写入的块没有 `__minspect_managed__` 标记（标记是后来加的），`stripOurBlocks` 按标记过滤清不掉旧块；17:52 的重装又追加了一份带标记的。
- 已知限制（写入 spec）：删除（rm）不记；非 git 仓不记；`git add/commit` 混在 Bash 里的 index 漂移；用户 WIP 未暂存改动会被并入首个 Bash 编辑的 diff（fallback 基线）。
