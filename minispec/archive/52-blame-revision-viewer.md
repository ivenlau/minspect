---
id: 20260430-blame-revision-viewer
status: closed
owner: ivenlau
---

# Why

卡 51 后端已经能按 revision 返回历史 content + blame。本卡把它接上 UI：
RevisionsPopover 点一个版本，整个 BlamePage 切到那个时间点的视图（全文 +
行着色），顶部横幅告诉用户"我在看历史版本"，一键回当前。

# Approach

- Considered:
  - 在同一页开"历史 / 当前"双栏对比：信息密度过高，BlamePage 已经 3 栏。
  - 独立路由 `#/ws/.../file/...@rev`：改路由表 + 刷新会丢状态。
  - `revisionEditId` state + URL query 同步：最小改动，分享链接可复原，
    F5 刷新保留。
- Chosen: 状态 + URL query + 顶部横幅。现有 RevisionsPopover 的 hover
  预览行为保留；点选从"滚到行"改为"切 revision"。

# Scope

- In:
  - `BlamePage` 新增 `revisionEditId: string | null`（null = current）
  - URL sync：`#/ws/.../file/...?rev=<edit_id>`（用 URLSearchParams，
    route kind 不变）
  - `usePoll` 的 URL 条件：`revisionEditId` 非空时拼 `&edit=<id>`
  - `RevisionsPopover.onSelect` 行为切换为 `setRevisionEditId(edit.id)` +
    关闭 popover；hover 预览（滚动高亮）保留不变
  - 列表里最新 edit 标注 `(current)`（等于最末 edit）
  - 顶部横幅：`revisionEditId !== null` 时渲染
    `[🕐] Viewing revision from YYYY-MM-DD HH:mm (N of M)  [→ Back to current]`
  - 横幅 "Back to current" 按钮 → `setRevisionEditId(null)` + 清 URL query
  - i18n 新增 keys: `blame.viewingRevision`（带时间 + 序号）、`blame.backToCurrent`、
    `blame.revisionCurrent`
- Out:
  - 差异视图（两个 revision 之间的 diff）
  - AST overlay 按 revision 回退
  - 在 revision 模式下禁用 Revert UI（Revert 自己已按 edit_id 工作，在
    历史视图点 revert 仍然是"把该 edit 之前的状态写回"，语义一致，保留）

# Acceptance

- [ ] Given BlamePage 打开一个文件, When 不操作 revisions, Then 视图与本卡
      落地前完全一致（零回归）。
- [ ] Given 打开 revisions popover 点其中一个版本, When 点击, Then popover
      关闭，BlamePage 的代码区切到那个 revision 的 `after` 全文，左侧行着
      色反映那时的 blame，URL 多 `?rev=<edit_id>`。
- [ ] Given revision 模式下, When 浏览器 F5 刷新, Then 回到同一 revision。
- [ ] Given revision 模式, When 点顶部横幅的 "Back to current", Then 回到
      最新视图，URL 的 `?rev=` 消失。
- [ ] Given revisions popover 打开, Then 最末（最新）那一条 edit 旁边显示
      `(current)` 标签。
- [ ] Given `?rev=<不属于该文件的 edit id>`, Then 退回 current + 清 URL
      query（或显示 inline error 块，二选一）。
- [ ] Given zh 语言, Then 横幅 / current 标签全中文，无硬编码残留。

# Plan

- [ ] T1 `packages/ui/src/router/index.ts`（或 BlamePage 自己解析）：从
      location 里取 `?rev=` 到 revisionEditId；反向写回用 `history.replaceState`
      + `hashchange` 触发一次 useRoute。
      Expected output: 改完后 URL 的 `rev` query 和 state 双向同步。
- [ ] T2 `packages/ui/src/pages/BlamePage.tsx`：
      - 读 `revisionEditId` state
      - `url = /api/blame?workspace=&file=${...}${revisionEditId ? '&edit=' + revisionEditId : ''}`
      - 顶部加横幅 `RevisionBanner`（纯组件，props: `{edit, totalEdits, onBack}`）
      - 组件内部用 `edits[]` 找到当前 revision 在链中的序号（N of M）
- [ ] T3 `packages/ui/src/features/blame/RevisionsPopover.tsx`：
      - `onSelect(edit.id)` 由父组件语义改为"切 revision"（组件内不需要知
        道新旧语义，只透传）
      - 最末 edit `edits[edits.length - 1]` 旁渲染 `(current)` 小 tag
- [ ] T4 i18n：`packages/ui/src/i18n/strings.ts` 新增 3 个 key：
      - `blame.viewingRevision: ({when, n, total}) =>`
      - `blame.backToCurrent`
      - `blame.revisionCurrent`
      （英/中）
- [ ] T5 Tests:
      - `BlamePage.test.tsx`（若现存；若没有新建小规模）mock `/api/blame`
        验证 `?edit=` 透传
      - `RevisionsPopover.test.ts` 补一个 "last edit shows (current)"
      - i18n 漂移测自动覆盖新 key
- [ ] T6 Spec 更新 `minispec/specs/ui.md`：Blame 页面章节加"revision 视图"
      小节 + 横幅图示 + URL 格式。

# Risks and Rollback

- Risk: Codex 来源文件 revision 视图是碎片（卡 51 已声明是继承限制）。
  缓解：横幅仅展示时间/序号，不声称是"完整文件"；Codex 的碎片与当前视图
  一致，用户感知不变。
- Risk: 误把 Revert 的"turn id"和 revision 的"edit id"搞混。
  缓解：revision 精确到 edit（一个文件某一次改动），RevertModal 继续按 turn
  或 edit 工作，路径不变。
- Risk: URL `?rev=` 与未来别的 query 冲突。
  缓解：前缀 `rev=` 足够独特；router 里只解析这一个 key，其它原样保留。
- Rollback: 删横幅 + state + URL sync；`RevisionsPopover.onSelect` 行为还
  原回"滚到第一处对应行"（即卡 24 的原行为）。

# Notes

- 横幅时间格式同现有 RevisionsPopover 的 `relTime`（< 7 天相对，>= 7 天
  YYYY-MM-DD）——视觉一致。
- 本卡依赖 51。51 的 `/api/blame?edit=` 没落地时，BlamePage 即便状态有值也
  拿不到历史数据——分两卡正是为了这种分阶段可发布。
