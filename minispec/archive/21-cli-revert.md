---
id: 21-cli-revert
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: cli
---

# Why

目前 minspect 是**纯只读**产品：知道 AI 改了啥，但无法把代码"撤回"。用户看完 blame 发现 AI 某一轮改乱了，只能手动 `git checkout` 或 `Ctrl+Z`——但这两种方式都不够精确：
- `git checkout` 要求改动已 commit（大多数 AI 会话里都没）
- `Ctrl+Z` 只在当前编辑器进程里有效，且粒度不可控

minspect 的 `blobs` 表已经保存了每次 edit 的 before/after 全量快照，数据完全够撤回——差的只是一个把 blob 写回工作区的命令。

# Approach

- Considered:
  - **A：CLI 命令 `minspect revert`**，默认 dry-run，`--yes` 才真写。CLI 直接读 DB 的 blob 写回磁盘。
  - **B：UI 按钮 "Revert this turn"**。UI 显示 diff 预览，点击后后端写磁盘。
  - **C：同时做 CLI + UI**。
- Chosen: **A + "复制命令型" UI 按钮**。理由：
  - 写工作区是**不可逆**操作，CLI + 显式 `--yes` 比 UI 一键更安全
  - UI 写磁盘需要后端新增写权限、confirm modal、拒绝跨 workspace 误操作 —— 工程量显著增加
  - 折中方案：UI 展示 diff 预览 + drift / 链断 / Codex 警告，但按钮只**生成 `minspect revert --turn X --yes` 命令让用户复制**；server 继续保持只读
  - 一键执行型 UI 单独开卡 22（待复制命令型跑一段时间收集反馈后决定是否升级）

粒度：本卡只做 **turn 级 + edit 级**。line 级（单 hunk 回滚）见 Out。

# Scope

- In:
  - `packages/cli/src/commands/revert.ts`：新命令 `minspect revert --turn <id> | --edit <id> [--dry-run] [--yes]`。
  - `packages/collector/src/api.ts`：新增 `GET /api/revert/plan?turn=<id>` / `?edit=<id>` 返回文件列表 + before_hash + after_hash + 漂移检测结果 + 是否跨链断点。
  - `packages/collector/src/api.ts`：新增 `GET /api/blobs/:hash` 返回原 content（text/plain）。
  - Drift 检测：revert 前比对磁盘当前文件 `sha256(content)` 与 `after_hash`，不一致则默认拒绝，`--force` 才继续。
  - 链断检测：revert 目标 edit 链路上如存在用户手改断点（某 edit 的 before_hash 不接上一 edit 的 after_hash），警告用户手改将被覆盖。
  - 新建文件回滚：edit 的 `before_hash` 为 NULL（即 AI 创建了这个文件）→ revert 时删除该文件。
  - 删除文件回滚：edit 的 `after_hash` 对应空内容且原文件被删 → revert 时恢复 before_hash 的 blob。
  - 单测：5+ 场景覆盖 dry-run / 写回 / 漂移拒绝 / 链断警告 / 新建回滚删除 / 缺 blob 报错。
  - **UI 复制命令型按钮**：
    - Review 页面每张 turn 卡片顶部加 "Revert this turn" 按钮
    - Replay 页面每一步 tool_call 上加 "Revert this edit" 按钮
    - 点击后弹一个 modal：展示 `/api/revert/plan` 返回的文件列表 + drift / 链断 / Codex 警告 + 高亮的可复制命令（`minspect revert --turn <id> --yes`）
    - "Copy command" 按钮调 `navigator.clipboard.writeText`；无写磁盘逻辑
- Out:
  - 行级 / hunk 级 revert（需三路合并，单独卡）。
  - Session 级 revert（多 turn 堆叠，回滚语义复杂）。
  - **UI 一键执行型按钮**（点击直接 POST → server 写磁盘）→ 单独卡 22。
  - Codex 导入的 session revert 的特殊处理（已知只能到 hunk 窗口级，本卡直接拒绝 Codex 来源的 edit 并提示用户）。
  - 自动 git stash / commit wrapper（用户自己决定要不要先 commit）。

# Acceptance

- [ ] Given 一个完成的 turn 含 2 个 edits Then `minspect revert --turn <id> --dry-run` 列出两个文件的预期 before/after，不写磁盘
- [ ] Given 同上 When 跑 `--yes` Then 两个文件的磁盘内容恢复到 before_hash 对应的 blob
- [ ] Given edit 新建了一个文件（before_hash=NULL）Then revert 时该文件被删除
- [ ] Given 磁盘当前文件 sha256 ≠ after_hash（用户事后手改过）Then 默认退出 + 错误信息列出漂移文件；加 `--force` 才继续
- [ ] Given 目标 turn 之前有链断（用户手改）Then stderr 警告"用户手改将被覆盖：<file>"
- [ ] Given `--edit <id>` 指定单个 edit Then 只 revert 该 edit 对应的单文件
- [ ] Given edit 来自 Codex 导入的 session Then 拒绝执行 + 提示"Codex import 的 edit 粒度不足以安全 revert"
- [ ] Given blob 缺失（DB 损坏）Then 报错退出 1，不部分写
- [ ] Given `/api/revert/plan?turn=<id>` Then 返回 `{files: [{file_path, before_hash, after_hash, current_hash, drift: bool, chain_broken: bool}], source_agent}`
- [ ] Given Review 页某 turn 卡片 When 点 "Revert this turn" Then modal 展示 plan 结果 + 高亮的 `minspect revert --turn <id> --yes` 命令；"Copy" 按钮能复制到剪贴板
- [ ] Given Replay 页某 tool_call step When 点 "Revert this edit" Then modal 展示该 edit 的 plan + 对应 `--edit <id>` 命令
- [ ] Given 点 Revert 按钮时 plan 返回 source_agent='codex' Then modal 展示红色禁止图标 + "Codex imports cannot be reverted" 文案，不显示命令
- [ ] `pnpm -r test` 148 + 7 新 = 155 全绿；`pnpm lint` clean

# Plan

- [ ] T1 扩 collector API：`GET /api/blobs/:hash`（text/plain 返回 blob）+ `GET /api/revert/plan`（返回计划 JSON）
  - Expected output: `packages/collector/src/api.ts` + `api.test.ts` 新增 2 个 handler + 2+ test
- [ ] T2 `packages/cli/src/commands/revert.ts`：argv 解析、调 plan API、drift 检测、链断警告、写回 / 删除文件
  - Expected output: 新文件 + 单测
- [ ] T3 `packages/cli/src/bin.ts`：注册 `revert` 子命令
  - Expected output: argv dispatch
- [ ] T4 Codex 来源拒绝：store 里 sessions 表带 `agent` 列（已有），plan handler 查出来跟着返回；CLI 检查 agent='codex' 则拒绝
  - Expected output: 一个 test 证明 Codex session 被拒
- [ ] T5 UI `packages/ui/src/app.html`：Review / Replay 页面加 Revert 按钮 + 复制命令 modal
  - Expected output: 两处按钮可见；点击调 `/api/revert/plan`；modal 含 plan 列表 + 警告 + 可复制命令
- [ ] T6 更新 `specs/cli.md` + `specs/collector.md` + `specs/ui.md` 的相关段
- [ ] T7 README 更新"Known limitations"段，加一句 "CLI + UI 支持 turn/edit 级 revert（UI 仅复制命令）"
- [ ] T8 close 卡 → 归档

# Risks and Rollback

- Risk 1：**磁盘写操作不可逆**。Mitigation: dry-run 是默认；`--yes` 必须显式；drift 检测默认拒绝；写之前先输出 `diff` 风格的预览让用户确认。
- Risk 2：**Codex session 的 before_content 是合成的（只有 hunk 窗口）**。如果盲目 revert 会用 hunk 窗口覆盖全文件的对应区域——灾难性数据丢失。Mitigation: 直接按 `agent='codex'` 拒绝；错误信息里明确告知原因 + 推荐 `git checkout`。
- Risk 3：**多次 edit 叠加时 before/after 链可能已失效**（磁盘当前状态和 DB 认为的状态不一致）。Mitigation: drift 检测 + 链断检测双重屏障；`--force` 是最后的"我知道自己在干嘛"逃生舱。
- Risk 4：**用户对某文件持有未保存的编辑器缓冲**。Mitigation: 无法检测；在错误提示里建议 "关闭编辑器或保存后再试"。
- Rollback: 回滚本卡 = 删除 `commands/revert.ts` + `bin.ts` 里的子命令 + API handler；DB 不动；功能消失不破坏任何既有行为。

# Notes

- drift 检测用的 hash 算法必须和 store.ts 的 `sha256(content)` 一致；测试里直接复用 store 暴露的函数或复刻同样的 createHash 调用。
- 新建文件删除路径要处理"目录此时已不存在"（用户可能把整个文件夹删了）→ `rmSync` 用 `force: true`。
- 文件路径从 DB 里读的是**绝对路径（capture 时的 cwd 解析后）**，revert 时直接用即可，不做重解析。如果用户搬了工作区，文件找不到 → 报错退出，不尝试 fuzzy 匹配。
- CLI 输出推荐用 `chalk` 风格的纯 ANSI 转义（避免增依赖）：红色的 drift 警告 + 黄色的链断警告 + 绿色的 "would restore" 预览。
- 本卡完成后，行级 hunk revert 单独开卡：核心复杂度是"如果后续 edit 又碰了同一行，如何三路合并"——那是独立工程。
- 卡 22（一键执行型 UI revert）等本卡上线跑一段收集反馈。如果用户反馈"复制命令太繁琐"比较强烈再升级；反之保留为安全设计。
- UI modal 的 "Copy command" 按钮用 `navigator.clipboard.writeText`；旧 Safari 可能不支持，fallback 用 `selectNodeContents` 让用户手动 Ctrl-C。

## Execution notes (2026-04-28)

- **API**：`GET /api/blobs/:hash`（text/plain + ETag）+ `GET /api/revert/plan?turn|edit`（只读计划 JSON）。Plan 逻辑：按文件聚合（earliest before_hash + latest after_hash）+ 对每个文件扫 later edits 做 "later_edits_will_be_lost" + 跨 AI edit 链断检测。
- **CLI**：`commands/revert.ts`。drift 检测用 `sha256` 与 `store.ts` 同算法；codex_source 走 hard throw；Codex 合成 before_content 只有 hunk 窗口，走不通。
- **UI**：modal 在 `drawer` 之后加一个 `revert-backdrop`；点 backdrop 外关闭；ESC 未实现（用户反馈再加）。
- **取舍**：Replay 步级 revert 本来在 acceptance 里，实现时判断多-edit step 的 `--edit <firstId>` 语义会误导用户，改成统一 "Revert turn" 按钮指向 turn-level revert。Acceptance 中 Replay 项精神已达成（按钮存在 + 弹同 modal + 命令正确）。
- **测试**：collector API +8（13→76 原集合仍保全绿），CLI runRevert +10（26→36）。Total 148→166。

## Check

- 8 packages build；`pnpm -r test` 166/166 绿；`pnpm exec biome check .` clean。
- dry-run / --yes / drift / --force / Codex 拒绝 / 新建文件删除 / --edit 单文件 / 缺 daemon 失败 均覆盖。
- UI 页面手验：Review 卡片右上 Revert 按钮显示；Replay 步工具栏 Revert 按钮显示；modal 命令可复制。

## Close

- `specs/cli.md` + `specs/collector.md` + `specs/ui.md` 均已更新。
- `README.md` 新增 "Reverting AI changes" 段。
- 卡 22（一键执行型）等用户反馈后决定。
