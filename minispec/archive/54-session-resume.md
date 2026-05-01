---
id: 54-session-resume
status: closed
---

# Why

用户在 SessionOverviewPage 看到一个 session 后，想回到那个 agent 继续对话。目前只能手动打开终端、cd 到 workspace、输入 resume 命令。加一个 Resume 按钮可以直接在用户电脑上打开终端并执行对应 agent 的 resume 命令，省去手动操作。

# Approach

- 唯一合理方案：Collector 新增 `POST /api/sessions/:id/resume` endpoint，后端用 `child_process.spawn` 在新终端窗口执行 agent 的 resume 命令。UI 新增 Resume 按钮调用该 endpoint。
- 考虑过 Clipboard 模式（复制命令到剪贴板），但用户明确要求方案 B（直接打开终端）。
- 跨平台终端检测策略：
  - Windows: 优先 PowerShell（`Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd ...; claude --resume ...'`），fallback cmd（`start "title" /D "path" cmd /k "claude --resume ..."`）
  - macOS: `open -a Terminal` + 内部 shell 脚本 `cd + exec`
  - Linux: 依次尝试 `x-terminal-emulator` → `xterm`，均不可用返回错误
- Agent resume 命令映射：
  - `claude-code`: `claude --resume <session-id>`（已确认 `--help` 支持 `-r, --resume [value]`）
  - `opencode`: 暂不支持（未安装，resume 命令待确认）
  - `codex`: 不支持（纯 import-only，无交互式 session）
  - `aider`: 不支持（stub adapter）
- UI 仅对 `claude-code` agent 显示 Resume 按钮，其它 agent 隐藏。

# Scope

- In:
  - collector: `POST /api/sessions/:id/resume` endpoint
  - collector: `spawnResume(agent, sessionId, workspacePath)` 跨平台终端 spawn 函数
  - ui: SessionOverviewPage 新增 Resume 按钮（Play icon），仅 `claude-code` 显示
  - i18n: resume 相关文案（EN + zh）
- Out:
  - opencode resume（待确认命令语法）
  - codex / aider resume（不支持）
  - 终端内嵌（不嵌入 UI，只打开外部终端）
  - resume 后自动刷新 session 数据（靠现有轮询机制）

# Acceptance

- [x] `POST /api/sessions/<id>/resume` 返回 200 `{ok: true, command: "..."}`，session 的 agent 为 `claude-code` 时
- [x] `POST /api/sessions/<id>/resume` session 的 agent 不支持 resume 时返回 400 `{error: 'unsupported_agent', agent: "..."}`
- [x] `POST /api/sessions/<nonexistent>` 返回 404
- [x] Windows 下成功打开 PowerShell 窗口并执行 `claude --resume <id>`（在正确的 workspace 目录下）
- [x] Windows 无 PowerShell 时 fallback 到 cmd
- [x] SessionOverviewPage 对 `claude-code` session 显示 Resume 按钮（Play icon），其它 agent 不显示
- [x] 点击 Resume 按钮调用 API，成功后按钮短暂显示 ✓ 状态
- [x] 点击 Resume 按钮调用失败时显示错误提示
- [x] 新增测试通过，现有 107 collector + 65 UI 测试不回归

# Plan

- [x] T1 `spawnResume` 函数：
  - 新增 `packages/collector/src/spawn-resume.ts`
  - 导出 `spawnResume(agent: string, sessionId: string, workspacePath: string): { ok: boolean; command: string; error?: string }`
  - Windows: 优先 `pwsh`/`powershell -NoExit -Command`，fallback `cmd /c start ... cmd /k`
  - macOS: `open -a Terminal` + `osascript`
  - Linux: 依次尝试 `x-terminal-emulator` → `xterm` → `gnome-terminal` 等
  - agent 命令映射：`claude-code` → `claude --resume <id>`，其它 → 返回 `unsupported_agent`
  - Expected output: 函数实现 ✓

- [x] T2 API endpoint：
  - 新增 `packages/collector/src/api.ts` 的 `POST /api/sessions/:id/resume` 路由
  - 查 session 的 `agent` + `workspace_id`，调 `spawnResume`
  - 成功返回 `{ok: true, command: "..."}`，不支持返回 400，未找到返回 404
  - Expected output: 路由实现 ✓

- [x] T3 UI Resume 按钮：
  - SessionOverviewPage 的 `titleRow` 里 Resume 按钮放在 Delete 按钮左侧
  - `agent === 'claude-code'` 时显示，其它隐藏
  - 点击调 `POST /api/sessions/:id/resume`
  - 成功：按钮短暂显示 ✓（2s 后恢复），失败：显示错误文字
  - Expected output: 组件实现 ✓

- [x] T4 i18n 文案：
  - `strings.ts` 新增 `sessionOverview.resumeSession` / `sessionOverview.resumeSuccess` / `sessionOverview.resumeFailed` 等 key
  - Expected output: EN + zh 文案齐全 ✓

- [x] T5 测试 + lint：
  - `pnpm -r test` 全绿（107 collector + 65 UI），`pnpm -r build` 成功
  - lint 新增文件无问题（pre-existing CRLF issues in JSON files only）
  - Expected output: 所有测试通过 ✓

# Risks and Rollback

- Risk: 用户未安装 `claude` CLI → spawn 成功但命令立即退出。
  - Mitigation: 前端在 agent 不支持时隐藏按钮；命令执行失败时 UI 显示错误。
- Risk: Windows PowerShell 执行策略阻止脚本执行。
  - Mitigation: 使用 `-Command` 参数直接执行命令（不走 `.ps1` 文件），不受 ExecutionPolicy 限制。
- Risk: Linux 没有可用的终端模拟器。
  - Mitigation: 返回明确错误信息，UI 提示用户手动执行。
- Rollback: 删除 `spawn-resume.ts`、`POST /api/sessions/:id/resume` 路由、UI Resume 按钮。

# Notes

- Claude Code resume 命令：`claude --resume <session-id>`（`--help` 确认 `-r, --resume [value]`）
- 无 `--cwd` flag，通过在 spawn 命令前 `cd <workspace>` 实现工作目录切换
- Windows: 写临时 `.bat` 文件（`cd /d` + `powershell -NoExit -Command`），`cmd /c start cmd /k <bat>` 打开可见窗口。bat 启动 PowerShell 后 PowerShell 加载用户 `$PROFILE`（PATH 含 git-bash）。同时从注册表 `HKLM/HKCU\SOFTWARE\GitForWindows` 读 git 安装路径，设 `CLAUDE_CODE_GIT_BASH_PATH` 环境变量保底。
- macOS: 单个 `osascript` 调用 `tell application "Terminal" to activate; do script "..."`，原子执行无竞态。`escapeAppleScript()` 处理 `\` 和 `"` 转义。
- Linux: `TERMINALS` 表驱动，每个终端定义 `buildArgs`。`gnome-terminal` 用 `--`（不依赖已废弃的 `-e`），其它用 `-e sh -c`。`command -v` 检测（POSIX 标准，Alpine 也支持）。`quotePosix()` 统一单引号转义，无双重转义。
- Resume 不是阻塞操作——`spawn` + `detached: true` + `.unref()` 后立即返回，终端窗口独立运行
- `fireAndForget` 监听 `child.on('error', () => {})` 防止异步 spawn 错误 crash daemon
- 实际文件：`packages/collector/src/spawn-resume.ts`、`packages/collector/src/api.ts`（+import + POST route）、`packages/ui/src/pages/SessionOverviewPage.tsx`（+resume button/state）、`packages/ui/src/pages/SessionOverviewPage.module.css`（+.resumeBtn/.resumeError）、`packages/ui/src/i18n/strings.ts`（+3 keys）

## Close (2026-05-01)

- Domain specs updated: collector.md (spawnResume + POST /api/sessions/:id/resume), ui.md (resume button + endpoint)
- Card status: closed
- Moved to minispec/archive/
