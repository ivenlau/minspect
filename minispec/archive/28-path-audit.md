---
id: 28-path-audit
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: collector
---

# Why

卡 24 修了一个 Blame tree 上的 Windows 路径归一化 bug（tree 用 `/`，DB 用 `\`，href 用归一化路径导致查询 miss）。这类问题很可能还有别处 —— 只是还没被发现。花 1h 做一次全局审计值得。

# Approach

搜所有路径处理代码点，核对 (a) display/layout 归一化 vs (b) API/DB 身份的区分是否正确。

# Scope

- In:
  - grep 所有 `replace(/\\/g, '/')`、`split(/[\\/]/)`、`encodeURIComponent` 跟文件路径相关的地方
  - 对每处检查：归一化后是否用于查询或 URL path / 对比？如果是 → bug
  - 修补 + 加测试（至少 3 个 Windows 路径 fixture）
- Out:
  - 其它平台 corner cases（Linux/macOS 已经工作，不引入新规范）
  - POSIX ⇔ Windows path conversion utility library（未来有需要再抽）

# Acceptance

- [ ] 全局 grep + 手工确认每处归一化用途
- [ ] 至少 3 个新 test fixture 用 Windows 反斜杠路径触发端到端 navigation + blame
- [ ] 测试全绿，biome clean

# Plan

- [ ] T1 grep + 列清单（ChangeLog 式文档记录每处）
- [ ] T2 修补各处（如有）
- [ ] T3 新测试
- [ ] T4 close

# Risks and Rollback

- Risk: 动到太多地方回归大。Mitigation: 每处改动独立提交，覆盖测试。
- Rollback: 单点回退 easy。

# Notes

- 上次的 bug 在 `buildFileTree.ts`。重点核对其它文件树/blame 逻辑。

## Execution notes (2026-04-28)

**Audit 结果**（grep `replace(/\\\\/g)` + `split(/[\\\\/]/)`）：

| 位置 | 用途 | 判定 |
|---|---|---|
| `buildFileTree.ts:23` | tree hierarchy 构建 | ✅ 安全（卡 24 已分 `fullPath` vs 归一化 `_parts`）|
| `install-post-commit-hook.ts:14` | 写 shell 脚本的 git-bash 路径 | ✅ 正确（shell 脚本必须 `/`）|
| `link-commit.test.ts:95` | 测试断言 | ✅ 测试代码只 |
| `WorkspacePage/ReplayPage/DashboardPage/BlamePage/WorkspacesSidebar/FileTreeSidebar` 的 `pathTail()` | UI 显示最后一段文件名 | ✅ 仅展示，不入查询 |

**找到 1 个真 bug**：`commit-link.ts` 的 workspace/file_path 匹配在 Windows 上从来没 work 过：
- Claude Code hook 存的 workspace_id / edits.file_path 是 OS-native（Windows 上是 `\`）
- 用户的 `.git/hooks/post-commit` 调 `minspect link-commit` 时 `git rev-parse --show-toplevel` 返回 `/`，`git diff --name-only` 返回 repo-relative `/` 路径
- 所以查询 `workspace_id = ? AND file_path IN (...)` 在 Windows 上永远 miss

**修复**：两处 SQL 层加 `REPLACE(path, '\\', '/')` 归一化；JS 层 `candidatesFor(ws, relFile)` 生成 4 个候选绝对路径（覆盖 fwd/back slash × join char）。

新增 2 个 Windows 测试场景覆盖：
- 绝对反斜杠 edit 路径 vs git 相对正斜杠路径匹配
- git 正斜杠 workspace vs DB 反斜杠 workspace_id 匹配

## Check

- `pnpm -r test` 214 tests pass（collector +2）
- biome clean
- Linux/macOS 用户不受回归影响（路径本来就全 `/`，REPLACE 空转）

## Close

- `specs/collector.md` 里 `POST /commit-links` 条目加一句"路径比较分隔符归一"
- 卡归档
