---
id: 06-git-commit-link
status: closed
owner: ivenlau
closed_at: 2026-04-27
spec: collector+cli
---

# Why

设计决策要求"git 感知"：每次 edit 绑定 branch/head，用户 commit 后把 edit 关联到 commit SHA。这让 Review 视图能说"这个 commit/PR 里 AI 改了哪些东西"。

# Approach

- collector 新增 `POST /commit-links`；`linkCommit(store, req)` 做 workspace+file+时间窗匹配。
- CLI `link-commit` 子命令从 git 抽数据，POST 给 collector。
- `installPostCommitHook` 写 `.git/hooks/post-commit`，managed block 幂等。

# Scope / Acceptance / Plan / Risks

（见 changes 中原卡片）全部已勾选。

## Execution notes (2026-04-27)

- **schema**：`commit_links.confidence REAL NOT NULL DEFAULT 1.0` 写入 INITIAL_SCHEMA + schema.sql；applyMigrations 追加 try/catch 的 `ALTER TABLE ADD COLUMN`。
- **匹配**：24h 默认窗；workspace_id + file_path IN + NOT IN commit_links，天然幂等。
- **边界**：merge commit（parents>2）跳过；首 commit 用 `git show --name-only --format= HEAD`；非 repo/collector down 静默退出。
- **hook 脚本**：`# >>> minspect managed >>>` / `# <<< minspect managed <<<` 包裹；Windows bin 路径反斜杠→正斜杠以适配 git-bash。
- **flaky 治理**：根 vitest.config.ts 启用 `pool: 'forks', singleFork: true`（Windows 并发 git 敏感）；`rmSync` 清目录加 `maxRetries: 5, retryDelay: 50` + try/catch 兜底。

## Check (2026-04-27)

- install / build / test / lint 全绿。
- 70 tests 通过（core 14 + adapter 15 + collector 21 + cli 20）。
- commit-link 5 + link-commit 3 + install-post-commit 4 共 12 新测。

## Close (2026-04-27)

- 更新 `specs/collector.md`（新增 `/commit-links` 端点文档）。
- 更新 `specs/cli.md`（link-commit 与 installPostCommitHook 说明）。
- 卡状态 closed，归档。
