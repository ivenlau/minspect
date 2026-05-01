# UI

`@minspect/ui` — 本地 Web UI，由 collector 在 GET `/` 返回 React SPA。

## 实现方式

- **Vite + React 18 + TypeScript + CSS Modules**（卡 22 迁移）
- 构建产物：`pnpm --filter @minspect/ui build` → `dist/spa/index.html` + `dist/spa/assets/*`，gzipped JS < 60 KB
- collector `GET /` 返回 `getAppHtml()`；`GET /assets/*` 由 `@fastify/static` 服务
- **路由**：hash-based，无 history fallback
- **主题**：dark-only（IDE 习惯），暂不做 light
- **字体**：`@fontsource/inter` + `@fontsource/jetbrains-mono` 本地打包（离线可用）

## 路由表

| 路径 | 说明 |
|---|---|
| `#/` | Dashboard（默认首页） |
| `#/dashboard` | 同上 |
| `#/timeline` | 过渡期的 session 扁平列表（所有 workspace 混合） |
| `#/ws/<encoded-path>` | Workspace 详情 |
| `#/ws/<path>/session/<id>` | Session overview tab |
| `#/ws/<path>/session/<id>/review` | Session review tab |
| `#/ws/<path>/session/<id>/replay` | Session replay tab |
| `#/ws/<path>/session/<id>/files` | Session files tab |
| `#/ws/<path>/file/<encoded-file-path>` | Blame 视图 |
| `#/session/<id>` (legacy) | 识别为 legacy-timeline，提示用户切到新 URL |

其它 fragment → `not-found`。

## Public surface

- `getAppHtml(): string` — 读 `dist/spa/index.html`。build 未完成时抛错
- `getAppAssetsDir(): string` — 绝对路径到 `dist/spa`，供 `@fastify/static` 使用
- `getBuildHash(): string` — sha256(dist/spa/index.html).slice(0, 12)；`/api/build-info` 对外暴露供 SPA 自检陈旧

## 设计 token（`src/styles/tokens.css`）

所有颜色/间距都是 CSS 变量：`--bg-0/1/2`、`--text-0/1/2`、`--accent`、`--success/warn/danger/violet`、`--diff-add-bg/diff-del-bg`、`--font-sans/mono`、`--fs-10..20`、`--sp-1..6`、`--radius-2/3/4/6`。跟 Pencil mockup 一一对应。

## Layout primitives

- `Shell` — 垂直 topbar + body + statusbar
- `ThreePane` — sidebar(240) + main(flex) + optional inspector(320)
- `TopBar` — brand + breadcrumb + tabs slot + right slot + port pill（连接状态）
- `StatusBar` — left slot + queue/poisoned 计数（每 5s 轮询 `/api/queue-stats`）

## UI primitives

- `Card`（可选 header）、`Tabs`（segmented link group）、`Tree`（递归可展开）
- `Badge`（info/warn/danger/success/muted）
- `ClickRow`（a11y：渲染成 `<button>`，保留 row 视觉）
- `EmptyState`（lucide icon + title + optional subtitle；`compact` 变体缩小 padding）
- `Skeleton`（灰色 shimmer pulse 占位，可指定 width/height/radius）
- `LiveDot`（绿色脉冲 6px dot，`ended_at == null` 的 session 用）

## Hooks

- `useHashAnchor()` — 监听 `location.hash` 里 path 后第二个 `#<anchor>` 并 `scrollIntoView()`。挂在 `App` 根组件一次，覆盖所有路由。Session overview 点 turn 跳 `.../review#turn-<id>` 的滚动靠它。
- `useVirtualRows({scrollRef, totalRows, rowHeight, buffer})` — 固定行高虚拟化；BlamePage 使用。`computeVisible` 纯函数单独 export 便于单测。
- `useLang()` — 订阅 `minspect:lang-change` CustomEvent；返回 `{ lang, setLang, t }`。非组件 helper 直接 `import { t } from './i18n'` 读模块级状态（如 `topBarPropsFor(route, t)` / `unitLabel(range, t)` 走传参模式）。

## i18n（卡 39）

- **结构**：`src/i18n/index.ts`（runtime：`resolveInitialLang` → localStorage > navigator.language > en；`t()` 读模块 state；`useLang()` 订阅 CustomEvent）；`src/i18n/strings.ts`（~200 键的 `{ en, zh }` 表）。
- **LangToggle**：`src/components/LangToggle.tsx`，TopBar 在 ThemeToggle 前放 "EN / 中" 分段按钮；localStorage key 为 `minspect.lang`。
- **约定**：按域分组 common / topbar / theme / lang / tabs / crumbs / status / sidebar / filetree / dashboard / timeline / workspace / sessionOverview / sessionFiles / review / replay / blame / palette / revert / app；string value 可是字面量或 `(vars) => string`，后者支持单复数/插值；缺值走 EN fallback，缺键回退 key 自身供 dev 发现。
- **工作流**：新增用户可见文案只改 `strings.ts`；`i18n.test.ts` drift 测强制每 key en+zh 非空。

## Global features

- **CommandPalette**（`features/search/CommandPalette.tsx`）：⌘K / Ctrl+K 全局触发的跨 session 搜索弹层。debounce 200ms 调 `/api/search`，结果按 `kind` (prompt / explanation / file_path / reasoning / message) 分组；↑↓ Enter 键盘导航，Esc 关闭；点击按 kind 跳对应路由（prompt/reasoning/message → `#/ws/.../session/.../review#turn-<id>`，file_path → blame，explanation → session review）。

## 数据层

- `api.ts::getJson<T>(url, signal)` — fetch wrapper，非 2xx 抛 `ApiError`
- `api.ts::usePoll<T>(url, intervalMs)` — 轮询 hook，StrictMode 双执行安全，返回 `{data, error, loading, refetch}`
- 默认轮询间隔：statusbar 5s、health 10s、其它 5s（可调）

## Collector endpoints（UI 依赖）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | React SPA index.html |
| GET | `/assets/*` | 静态 bundle（JS/CSS/fonts） |
| GET | `/health` | `{status: 'ok'}` |
| GET | `/api/build-info` | `{ui_hash, server_started_at, server_code_mtime}` — SPA 自检/CLI 检测 stale daemon |
| GET | `/api/queue-stats` | `{queue: number, poisoned: number}` — statusbar 驱动 |
| GET | `/api/workspaces` | `{workspaces: [{path, session_count, total_edits, last_activity}]}` |
| GET | `/api/workspaces/:path` | Workspace 详情：counts + agents + sessions (with turn/file counts) + top files |
| GET | `/api/workspaces/:path/sessions` | 指定 workspace 的 session 列表 |
| GET | `/api/workspaces/:path/files` | 扁平文件列表（UI 构建树）：`{files: [{file_path, edit_count, last_edited, touch_count}]}` |
| GET | `/api/dashboard` | Dashboard 聚合：30 日 activity、top workspaces、top agents、alerts、recent feed |
| GET | `/api/sessions` | 全 workspace 混合，timeline 用 |
| GET | `/api/sessions/:id/files` | `{files: [{file_path, edit_count, first, last}]}` |
| DELETE | `/api/sessions/:id` | 删除 session 及所有关联数据（级联删除）；200 `{ok: true}` / 404 `{error: 'not_found'}` |
| POST | `/api/sessions/:id/resume` | 在新终端窗口执行 agent resume 命令；200 `{ok: true, command}` / 400 `{error: 'unsupported_agent'}` / 404 |
| GET | `/api/turns?session=` | `{turns: [...]}` 按 idx |
| GET | `/api/blame?workspace=&file=` | `{blame, turns, content, edits, chain_broken_edit_ids}` — blame 行带 session_id；edits 是该文件的 edit chain；chain_broken_edit_ids 是 before/after hash 不连续的点 |
| GET | `/api/ast?workspace=&file=` | `{nodes}` |
| GET | `/api/revert/plan?turn=&edit=` | revert plan；UI revert 按钮弹 modal 用 |
| GET | `/api/search?q=&limit=` | FTS5 跨 session 搜索：`{fts_available, results: [{kind, source_id, session_id, workspace_id, content, snippet}]}` |
| GET | `/api/blobs/:hash` | blob 原文；UI 不直接用（CLI 写回时 fetch） |

## Pages 实施状态

| 路由 | 卡 | 状态 |
|---|---|---|
| `#/` (Dashboard) | 23 | ✅ 实现 |
| `#/timeline` | 22 | ✅ 实现 |
| `#/ws/:path` | 23 | ✅ 实现 |
| `#/ws/.../session/:id` | 25 | ✅ Review + Replay 实现；Overview/Files 已上线 |
| `#/ws/.../file/*` (Blame) | 24 | ✅ 实现 |

## Revert UI（卡 21）

- Review 页每张 turn 卡片右上角 "Revert this turn" 按钮 → 弹 modal
- Replay 页每个非空 step 顶部工具栏 "Revert turn" 按钮 → 弹同一个 modal
- Modal 展示 `GET /api/revert/plan?turn=<id>` 的结果：
  - 文件列表 + kind（restore / delete）
  - later_edits_will_be_lost 黄色警告
  - chain_broken_user_edits 黄色警告
  - codex_source 红色禁止块 + 命令区隐藏
- Modal 底部有等宽命令框 `minspect revert --turn <id> --yes` + "copy" 按钮（`navigator.clipboard.writeText`；回退为 selectNodeContents）
- **UI 不直接写磁盘**；一键执行型 revert 留卡 22（观察期）。
- 新 UI 的 revert 入口在卡 25 重新接线；`/legacy/` 通道已在卡 32 下线，`minspect revert --turn ... --yes` 是唯一执行路径。

## Changes

### 55-blame-pre-existing (closed 2026-05-01)

**Why**
BlamePage 把已存在文件的所有行都染成 AI 编辑色，无法区分原文和 AI 改动。

**Scope 落地**
- `BlameRow` 接口新增 `is_pre_existing: boolean`
- BlameTable：pre-existing 行灰色 bar（`var(--bg-2)`）、无 turn label、`.codeUser` 样式
- LineInspector：点击 pre-existing 行显示 "原始内容" 说明，不显示 Revert 按钮
- i18n：新增 `blame.inspector.preExisting`（en/zh）
- 65 UI tests 全绿

### 54-session-resume (closed 2026-05-01)

**Why**
从 SessionOverviewPage 直接打开终端恢复 agent session，省去手动操作。

**Scope 落地**
- SessionOverviewPage 新增 Resume 按钮（Play icon），仅 `claude-code` agent 显示
- 点击调 `POST /api/sessions/:id/resume`，成功按钮短暂显示 ✓（2s），失败显示红色错误文字
- i18n: 3 个新 key（`resumeSession` / `resumeSuccess` / `resumeFailed`）

**Acceptance（全部通过）**
- Resume 按钮仅 `claude-code` 显示
- 成功/失败状态正确反馈
- 65 UI tests 全绿

> 完整记录：`minispec/archive/54-session-resume.md`.

### 53-session-delete (closed 2026-05-01)

**Why**
无用 session 占据 sidebar / timeline / workspace 列表，干扰浏览。需要提供 session 删除功能并要求二次确认。

**Scope 落地**
- `ConfirmDeleteModal` 组件：显示 session ID、agent、开始时间，警告不可撤销，取消/确认按钮
- `SessionOverviewPage` 顶部添加删除按钮（Trash2 icon），点击弹出 ConfirmDeleteModal
- 删除成功后跳转到所属 workspace 页面
- WorkspacesSidebar session 列表新增 agent 标签（`agentShort`：claude-code→claude, opencode→open, codex→codex）
- i18n: 6 个新 key（deleteSession / deleteConfirmTitle / deleteConfirmMessage / deleteConfirmWarning / deleteConfirmButton / deleteFailed）
- `/api/review` 响应新增 `agent` 字段

**Acceptance（全部通过）**
- SessionOverviewPage 右上角有删除按钮
- 点击弹出确认 modal，显示 session 信息 + 警告
- 确认删除后跳转 workspace 页面
- 65 UI tests 全绿

> 完整记录：`minispec/archive/53-session-delete.md`.

### 52-blame-revision-viewer (closed 2026-04-30)

**Why**
Revisions popover 从"滚到对应行"升级为"切到那个版本的 content + blame"。

**Scope 落地**
- `BlamePage`: `revisionEditId: string \| null` state，URL `?rev=<edit_id>` 双向同步（读自 hashchange，写用 `window.location.hash` 触发 `hashchange`，保留浏览器 back/forward）
- `/api/blame` URL 拼 `&edit=<id>`；响应 shape 和 live 完全一致，page 只改 `url` 一处
- `RevisionsPopover`: 最新 edit 标注 `(current)` 小 tag；`onSelect` 语义由父组件决定（父组件改成"setRevisionEditId"+ 关 popover），组件本身不区分
- `handleRevisionSelect`: 再点同一条 = 回 current；点其它 = 切过去
- 顶部横幅 `RevisionBanner`（amber 色）：`Clock` 图标 + `blame.viewingRevision({when, n, total})` + `→ Back to current` 按钮，`revisionEditId !== null` 时显示
- 移除旧 `selectedEditId` 态（被 URL-driven revisionEditId 取代；保留 `hoveredEditId` 做 hover 预览高亮）
- i18n: 新增 4 keys `blame.revisionCurrent` / `blame.viewingRevision` / `blame.viewingRevisionUnknown` / `blame.backToCurrent`

**Known limitations**
- Codex 来源文件的 after blob 是 hunk 窗口碎片，历史视图与当前视图同构继承（非本卡引入，adapter spec 已知限制）



### 39-i18n-full (closed 2026-04-28)

**Why**
UI 之前英文硬编码。用户要求和主题切换并列的中英文全量切换，方便 zh-first 用户使用。

**实现**
- 新增 `src/i18n/{index.ts,strings.ts}` + `src/components/LangToggle.tsx`
- ~200 键覆盖所有页面、layout、features（29 个文件）
- 非组件 helper 接收 `t` 作为参数（`topBarPropsFor(route, t)` / `unitLabel(range, t)`）
- `main.tsx` 顶部 `import './i18n'` 侧效应导入，在首屏前解析初始语言
- 12 个新 vitest 测试：drift 测 + `t()` 行为 + `setLang` 持久化 + 事件派发

**Not in**
- 后端 / CLI 日志文案（仅面向 UI 用户）
- locale-aware 数字/日期格式（现有 `toLocaleString` 跟随浏览器 lang 已够用）

**Why**
⌘K palette 占位 `alert('coming soon')` 终于接上真实后端。搜跨 session 的 prompt / reasoning / explanation / file path。

**Scope 落地**
- 新 `packages/ui/src/features/search/CommandPalette.{tsx,module.css}`：debounce 200ms fetch /api/search，结果按 KIND_ORDER (prompt / explanation / file_path / reasoning / message) 分组，↑↓ 高亮，Enter 打开，Esc / backdrop 关闭
- `App.tsx` 挂全局 `keydown` 监听 Cmd/Ctrl+K toggle palette
- 点击结果按 kind 路由：prompt/reasoning/message → `#/ws/.../session/.../review#turn-<source_id>`（依赖卡 31 `useHashAnchor` 滚动）；file_path → `#/ws/.../file/<content>`（content 即 file_path 原值）；explanation → session review
- 结果 snippet 用 `dangerouslySetInnerHTML` 渲染 `<mark>` 高亮（localhost-only 服务，snippet 源自 collector 自身）

**Out**
- Cmdk 库（自己实现 + lucide icons 够用）
- 最近搜索历史
- workspace 前缀过滤

**Bundle**
- 69.49 → 71.64 KB gzip (+2.15 KB)

> 完整记录：`minispec/archive/33-cross-session-search.md`.

### 30-blame-virtualization (closed 2026-04-28)

**Why**
`packages/ui/src/app.html`、`legacy-app.html` 之类 1000+ 行的文件，blame 表一次性挂全部 DOM 节点，首帧和滚动都卡。

**Scope 落地**
- 新 `packages/ui/src/features/blame/useVirtualRows.ts`：`computeVisible` 纯函数 + `useVirtualRows` hook（scroll + `ResizeObserver` 订阅）
- `BlamePage.tsx` 抽 `BlameTable` 子组件，用 hook 只渲染 `[start, end]` 切片，外包 `height = totalRows × 22px` 的 spacer + 绝对定位 slice
- `BlamePage.module.css` 的 `.table` 移除 padding（不能和 abs-position 切片共存），`.row` 改成固定 `height: 22px + box-sizing: border-box`
- 7 个纯函数测试：空文件 / 隐藏容器 / 顶部 / 中段 / 底部 clamp / 小文件 / buffer=0

**Acceptance（落地）**
- select / chain-broken / same-turn 高亮保留不变
- 220 tests 全绿（含 7 新）；biome clean
- bundle 69.60 → 69.93 KB gzip（+0.33 KB，远低于 react-window 的 ~6 KB）
- 滚动滑动时 DOM 节点数量维持在 ~30 个（视口 20 + buffer 10）而非 N，首帧代价 O(视口) 而非 O(totalRows)

**Out（明确不做）**
- 动态行高 / 代码折行
- 水平虚拟化
- Ctrl+F 原生搜索只能搜视口内行 —— 目前接受此约束；如果报告为真问题再加自定义 in-file search

### 32-legacy-cleanup (closed 2026-04-28)

**Why**
新 React UI 跑了一段无 regression 报告，`/legacy/` vanilla 保底通道可以下线；`StubPage` 也完成了历史使命。

**Scope 落地**
- `rm packages/ui/src/legacy-app.html` + `rm packages/ui/scripts/copy-legacy.mjs`（空目录也删）
- `packages/ui/package.json` build：`tsc && vite build && node scripts/copy-legacy.mjs` → `tsc && vite build`
- `packages/ui/src/index.ts`：删除 `getLegacyAppHtml`
- `packages/collector/src/server.ts`：删除 `/legacy` + `/legacy/` 两条路由与对应 import
- `packages/collector/src/api.test.ts`：原 "GET /legacy/ returns vanilla HTML" 改成 "returns 404"
- 删除 `packages/ui/src/pages/StubPage.tsx`
- `App.tsx` 里 `'legacy-timeline'` / `'not-found'` 分支改用 `EmptyState` + `Link2Off` / `Compass` 图标（router 的 `legacy-timeline` kind 保留以软着陆老 bookmark）

**Acceptance（落地）**
- `find packages/ui/dist -name "legacy*"` 空
- collector 测试断言 `/legacy/` → 404 通过
- 213 tests 全绿；biome 160 files clean
- 实测 JS bundle 69.60 KB → 69.49 KB gzip（≈0.1 KB 减少，未达最初 ≥ 4 KB 目标；真实收益是少一份代码维护）

**Out**
- Event schema / DB migration 一律不动
- router 的 `legacy-timeline` kind 保留，防止 `#/session/:id` 老链接变 not-found

> 完整记录：`minispec/archive/32-legacy-cleanup.md`.

### 31-ui-polish (closed 2026-04-28)

**Why**
一堆小颗粒 UI 疏漏合并一张卡：Session overview → Review 点 turn anchor 不滚动；8+ 处 empty state 文案/图标各不相同；`ended_at == null` 的 session 没有进行中视觉标记。

**Scope 落地**
- 新 `useHashAnchor` hook（挂 `App`），监听 `hashchange` + mount，`requestAnimationFrame` 后 `scrollIntoView`
- 新 `EmptyState` primitive（lucide icon + title + subtitle + compact flag）
- 新 `Skeleton` + `LiveDot` primitive（CSS `@keyframes` shimmer / 1.8s 脉冲 box-shadow）
- 9 个页面 empty state 替换：WorkspacesSidebar、TimelinePage、DashboardPage、WorkspacePage、BlamePage、ReviewPage、ReplayPage、SessionFilesPage、SessionOverviewPage、FileTreeSidebar
- LiveDot wire 到 WorkspacesSidebar / TimelinePage / WorkspacePage 的 sessions 列
- `WorkspacesSidebar.module.css` 清理未用 selectors (`.empty`, `.dotOk/Warn/Danger`)

**Acceptance（落地）**
- Session overview 点 turn → Review 页滚到对应 turn card（经 `useHashAnchor`）
- 所有 empty state 统一 `EmptyState` + 图标（AlertCircle/Clock/FileText/FolderPlus/MessageSquare/Film/Filter/BarChart3/Activity）
- 进行中 session 在 sidebar/timeline/workspace 三处有绿色脉冲点
- biome clean；`pnpm -r test --run` 213 tests 全绿

**Out（延后）**
- 每页面 first-paint skeleton 占位（primitive 已提供，实际挂接留给后续 UI 迭代）
- 全站 loading 状态重做；theme 切换；动画系统

> 完整记录：`minispec/archive/31-ui-polish.md`.

### 25-ui-review-replay (closed 2026-04-28)

**Why**
最后一张前端升级卡。Review/Replay 从 vanilla 迁到新 shell，密度、交互、revert 入口按 Pencil 屏 4+5 完成。

**Scope 落地**
- `Hunk` primitive（可复用 diff 渲染：红绿背景、@@ 头、可选 context）
- `ReviewPage`：turn sidebar（12 turn 缩略列表 + level 彩条 + badge 提示 + filter-hidden 计数）+ filter bar（file path / keyword / level select / results count / export）+ TurnCard 列表（普通卡 + danger 红边框卡 + Revert turn 按钮 + explanation 块 + 每 edit inline diff）+ 自含 HTML export（可复用到 PR）
- `flattenReplaySteps` 工具（扁平化 turn → step，MultiEdit 合并为单 step，空 turn 占位 step）
- `ReplayPage`：96px scrubber strip（dots with danger/normal/current 样式 + Home/prev/next/end/autoplay 按钮）+ 主 step card（turn# + tool badge + counter + prompt + explanation + inline diff + Revert）+ step inspector（PREV 灰底块 + NEXT 高亮"press →" affordance + AGENT THINKING + TURN SO FAR 文件列表）
- Keyboard：`←` / `→` / `Home` / `End` / `Space`（autoplay toggle），自动清理，input/textarea 内不拦截
- `SessionPage` 路由分派（overview/files 继续 stub，review/replay 切换到实现）
- Revert modal 复用卡 21 via RevertModal 组件
- 6 new UI tests（flattenReplaySteps 全场景覆盖）

**Acceptance（全部通过）**
- 浏览器打开 `#/ws/.../session/:id/review` 看到 sidebar + filter + turn cards + diff
- 过滤 file/keyword/level 实时收窄列表
- danger 级别 turn 卡红边框
- 每张卡右上 "Revert turn" 按钮弹 modal（复用卡 21）
- `#/ws/.../session/:id/replay` 看到 scrubber + step card + inspector
- `←` / `→` 换 step；`Home` / `End` 跳首尾；`Space` toggle autoplay；autoplay 每秒前进一步到末尾自动停
- scrubber dot 点击跳到对应 step，当前 step 有放大 + accent outline
- "Revert turn" 按钮弹同一 modal
- Export 按钮生成自含 HTML 下载
- bundle 66 KB gzipped（+5 KB vs 卡 24，加 Hunk/Review/Replay/Scrubber 可接受）
- 204 tests pass；biome clean

**Out（明确不做）**
- 跨 session 代码搜索（⌘K palette）— 需要全文索引，独立卡
- 文件内 ⌘F 搜索 — 浏览器原生 Ctrl+F 已覆盖 DOM 文本
- Replay autoplay 动画过渡 — `Space` 只是每秒 setStepIdx，无 transition
- filter state 持久化到 localStorage — URL 不跟随，刷新重置

> 完整记录：`minispec/archive/25-ui-review-replay.md`.

### 24-ui-blame-upgrade (closed 2026-04-28)

**Why**
Pencil 屏 3 的 IDE 风 Blame 是 minspect 最核心的差异化界面。旧 vanilla 的 3 列 pre 表格没 hover 联动、没 inspector、没 heat strip。

**Scope 落地**
- `/api/workspaces/:path/files`：flat 文件列表（UI 端 `buildFileTree` 建树 + VSCode "compact folders" 风格合并单 child 目录）
- `/api/blame` 升级：blame 行带 session_id（配色用）；turns 返回里加 session_id + started_at；新增 `edits` 链 + `chain_broken_edit_ids`（before_hash/after_hash 不连续检测）
- `FileTreeSidebar`：workspace 作用域的文件树（替代 WorkspacesSidebar）
- `BlamePage`：
  - 顶部 file toolbar（路径 + line count + edits/sessions 数 + ⌘F 搜索占位 + revisions 按钮占位）
  - 30 段 `HeatStrip`：按 session 主导色染色
  - BlameTable：line# + 色条 + turn chip（`session-short·#idx`）+ 代码行
  - 每行 hover → 同 turn 所有行浅蓝高亮（`rowSameTurn`）
  - 点击行 → 选中态高亮 + Inspector 填充
  - 断链 edit 的行红色 bar
  - 5 色 session palette（accent / warn / violet / success / 红紫）循环
- `LineInspector`：选中行的 turn prompt / reasoning / final message / tool-call explanation / 该 turn 下的 edits / Revert 按钮
- `RevertModal`：从 legacy HTML 移植到 React，复用卡 21 的 `/api/revert/plan` + clipboard copy fallback
- App.tsx 路由 → sidebar 分派：Blame 用 FileTreeSidebar，其它继续用 WorkspacesSidebar

**Acceptance（全部通过）**
- `curl /api/workspaces/<path>/files` 返回正确聚合；UI 构建树正确压缩单 child 目录
- `curl /api/blame` 返回 373 blame 行 / 1 turn / 2 edits / 1 chain_broken on real data
- 浏览器手验：Blame 页 3 窗格；hover 联动；点击填充 Inspector；Revert 按钮弹 modal
- 8 new tests（6 buildFileTree + 2 collector：/files + blame session_id）
- bundle 60 KB gzipped（+6 KB vs 卡 23）
- 198 tests pass；biome clean

**Out（转到后续卡）**
- 跨文件搜索 / 文件内 ⌘F（留给卡 25）
- Monaco editor（已决策不上）
- 行级 revert（需三路合并，独立卡）

> 完整记录：`minispec/archive/24-ui-blame-upgrade.md`.

### 23-ui-dashboard-workspace (closed 2026-04-28)

**Why**
卡 22 落地后 Dashboard / Workspace 仍是 stub，用户价值未显现。Pencil 屏 1+2 要按原设计落实。

**Scope 落地**
- `/api/dashboard`：30 日 activity sparkline（缺日补 0）+ delta_pct（vs 前 30 日）+ top workspaces (5) + top agents (with pct) + alerts（detectors 聚合，按 level 排序）+ recent feed（最近 20 session_start + 30 tool_call 合并排序）
- `/api/workspaces/:path`：counts + agents + sessions (with turn_count + file_count per session) + top 500 files by edit_count
- Dashboard 页：ActivityCard (sparkline bars with opacity hinting)、Top Workspaces/Agents/Alerts 3 卡并排、Recent Activity feed
- Workspace 页：StatRow (4 小卡) + Sessions 表 (可点击跳 session) + Files 列表 (可点击跳 blame) + Inspector (path/agents/last activity)
- Dashboard 成为 `/` 默认页（取代 Timeline）
- 5 新 collector tests（dashboard + workspace detail + 404 + 原有 3 个）

**Acceptance（全部通过）**
- `curl /api/dashboard` 返回 30 天活动 + 真实 top_workspaces/top_agents/alerts/recent
- `curl /api/workspaces/<path>` 返回完整 detail，sessions 里带 turn_count/file_count
- `/api/workspaces/<不存在的>` 返回 404
- 浏览器 `/` 默认看到 Dashboard；点 workspace → Workspace 详情 + 右 Inspector；点 session 行 → 跳 session stub；点 file → 跳 blame stub
- bundle 54 KB gzipped（+3 KB vs 卡 22，Dashboard/Workspace 页面成本合理）
- 190 tests pass；biome clean

> 完整记录：`minispec/archive/23-ui-dashboard-workspace.md`.

### 22-ui-react-foundation (closed 2026-04-28)

**Why**
- vanilla 单文件 UI 无法承载 3 窗格 IDE 布局、Pencil 设计的 5 张屏
- Phase 2 排查"UI 不刷新"暴露了缺乏轮询 / 状态可见性的问题

**Scope 落地**
- Vite + React 18 + TS + CSS Modules
- 设计 token 完整落地（对齐 Pencil）
- Layout / UI primitives 搭完：Shell, ThreePane, TopBar, StatusBar, Card, Tabs, Tree, Badge, ClickRow
- Workspaces sidebar（左常驻，按 workspace 分组，可展开 session 列表）
- Timeline 页（新 UI 下旧扁平视图的等价实现）
- 其它 5 页 stub + 标注"coming in card 23/24/25"
- 新 collector endpoints: `/api/workspaces`, `/api/workspaces/:path/sessions`, `/api/queue-stats`
- `@fastify/static` 服务 `/assets/*`
- legacy vanilla HTML 搬到 `src/legacy-app.html`，`/legacy/` 路由保底
- 13 UI tests（router parsing + api wrapper）+ 4 collector tests（新 endpoints + legacy route）

**Acceptance（全部通过）**
- build 产物 51 KB gzipped（目标 < 200 KB）
- 端到端：`serve` → `GET /` 返回 React shell、`GET /legacy/` 返回 vanilla、`/api/workspaces` 和 `/api/queue-stats` 返回真实数据
- statusbar 5s 轮询 queue/poisoned 计数
- 187 tests 全绿；biome clean

> 完整记录：`minispec/archive/22-ui-react-foundation.md`.

### 09-ui-blame-view (closed 2026-04-27)

**Why**
MVP 可见交付物；没它所有采集、索引都看不见。

**Scope 调整**
- 原计划：Vite + React + Monaco。
- 实际：vanilla HTML + JS 单文件（由卡 22 最终迁移到 React + Vite）。
- 保留：hash 路由、空状态、prompt 抽屉、blame 三列表格、API 契约。
- 未做：Monaco 编辑器；HSL 颜色；invalidated 驱动。

**Acceptance**
- 6 项验收中 4 项映射到 API + HTML 逻辑，2 项降级（Monaco / invalidated 样式）。
- 空状态 + prompt 抽屉均落地。

> 完整记录：`minispec/archive/09-ui-blame-view.md`.
