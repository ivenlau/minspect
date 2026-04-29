---
id: 22-ui-react-foundation
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: ui
---

# Why

当前 `@minspect/ui` 是一个 1000+ 行的单文件 vanilla HTML，随着 Phase 2 功能增多（Review 过滤 / Replay 步进 / Revert modal）已出现：
- CSS 无作用域，新增组件易撞名
- 无组件复用，Review / Replay / Blame 的"卡片"、"hunk"、"按钮"都是硬编码
- 重绘靠 `innerHTML = ...`，路由切换要手工解绑事件监听器（Replay 就踩过这坑）
- 没有轮询，新 session 写入 DB 但 UI 看不到（真实诊断出的问题）

Pencil mockups（5 张屏）已确认目标视觉：3 窗格 IDE 风 + dark theme + workspace 分组 + dashboard。单文件 vanilla 做不动。

# Approach

- Considered:
  - A：**React + Vite + TypeScript**，CSS Modules + Lucide 图标。bundle ~150 KB gzipped。
  - B：Preact + Vite：小 3 KB 但生态小、二次招人难。
  - C：Svelte：编译型极轻，但团队学习曲线高。
  - D：坚持 vanilla + Web Components：避开框架成本但组件状态、列表 diff 都要手搓。
- Chosen: **A**。理由：React 的组件/Hook 模型对 IDE 级 UI（多窗格 + 面包屑 + 树 + tabs + modal）是成熟方案；team 已熟悉；Vite 的构建可以直接产出静态 asset 给 collector 服务，不引入 dev/prod 运行时差异。

构建策略：`pnpm --filter @minspect/ui build` → `dist/index.html` + `dist/assets/*` → collector `getAppHtml()` 读 `dist/index.html`、新增静态路由 `/assets/*`。保持"一个二进制就能跑"不破坏。

路由：hash-based（`#/ws/:path`），无需 collector history fallback。

# Scope

- In:
  - **工具链**：`packages/ui` 加 Vite + React 18 + TS。新 `vite.config.ts`、`tsconfig.json`（rootDir=src，jsx=react-jsx）、`src/main.tsx`、`src/App.tsx`。
  - **设计 token**：`src/styles/tokens.css`（CSS 变量：`--bg-0/1/2`、`--text-0/1/2`、`--accent/success/warn/danger`、字号阶、间距阶、border-radius），和 Pencil mockup 一致。
  - **全局样式**：`src/styles/base.css`（reset、dark theme 默认、Inter + JetBrains Mono 加载、system fallback）。
  - **Layout primitives**（src/layout/）：
    - `TopBar.tsx`（brand + breadcrumb + tabs slot + port pill）
    - `StatusBar.tsx`（左文本 slot + 右固定：queue: N · poisoned: N，每 5s 轮询 `/api/health` + `/api/queue-stats`）
    - `Sidebar.tsx`（workspaces tree 或 file tree 两种 variant）
    - `Inspector.tsx`（右侧 close 按钮 + body slot）
    - `ThreePane.tsx`（sidebar + main + optional inspector）
  - **UI primitives**（src/components/）：
    - `Card.tsx`、`Button.tsx`、`IconButton.tsx`、`Badge.tsx`、`Pill.tsx`、`Tabs.tsx`（segmented）、`Tree.tsx`（递归）、`Hunk.tsx`（可复用 diff 渲染）
  - **Router**：hash router。路由表：
    - `#/` → TimelinePage（过渡期保留，显示当前所有 session）
    - `#/ws/:encodedPath` → WorkspacePage（stub）
    - `#/ws/:path/session/:id` → SessionPage（stub）
    - `#/ws/:path/session/:id/review`、`.../replay` → stub
    - `#/ws/:path/file/:encodedFile` → BlamePage（stub）
  - **数据层**：`src/api.ts`（fetch wrapper 带 5s stale-while-revalidate 轮询 hook `usePoll<T>(url, interval)`）
  - **Workspaces sidebar**：实现完整。需要 collector 新端点 `/api/workspaces` 返回 `[{path, session_count, last_activity, total_edits}]`。
  - **Timeline 页面**：维持当前行为（列所有 session），但用新组件重新实现。作为 foundation 的 smoke test。
  - **Legacy HTML 保留**：原 `packages/ui/src/app.html` 搬到 `packages/ui/src/legacy-app.html`。collector 加 `getLegacyAppHtml()` 并注册 `GET /legacy/` 路由指向它。rollback 路径。
  - **Collector 改动**：
    - `getAppHtml()` 读新 `dist/index.html`
    - 新增 `/assets/*` 静态文件服务（用 `@fastify/static` 或手写 handler）
    - 新 API：`/api/workspaces`、`/api/queue-stats`（返回 `{queue: N, poisoned: N}` 基于 `<state_dir>/queue/` 和 `<state_dir>/queue/.poison/` 文件数）
- Out:
  - Dashboard / Workspace 详情 / Blame / Review / Replay 的**完整内容**（卡 23–25 分别做）
  - 历史数据的 migration —— 无 schema 改动
  - i18n、accessibility（a11y）audit —— 基础 semantic HTML 带上，但不做形式化 ARIA pass
  - Monaco editor（已决策不上）
  - Feature flag 切换新/旧 UI —— 用路由前缀（`/legacy/`）显式区分即可

# Acceptance

- [ ] `pnpm --filter @minspect/ui build` 产出 `dist/index.html` + `dist/assets/*.js` + `dist/assets/*.css`，gzipped JS < 200 KB
- [ ] `minspect serve` 启动后浏览器访问 `http://localhost:<port>/` 看到新 UI shell（dark theme、topbar、左 workspaces sidebar、右下 statusbar）
- [ ] `http://localhost:<port>/legacy/` 返回原 vanilla HTML（rollback 通道）
- [ ] statusbar 实时刷新 queue / poisoned 计数（写一个测试事件入队后 5s 内 UI 数字变化）
- [ ] workspaces sidebar 展示所有工作区，可展开显示 sessions；点击导航到 `#/ws/<path>` URL
- [ ] Timeline 页（默认 `#/`）能列出所有 session 并点击跳转
- [ ] 所有 stub 页面（Workspace/Session/Review/Replay/Blame）渲染"待卡 23-25 实现"占位 + 路由参数回显
- [ ] 键盘快捷键：⌘K 打开 command palette 占位（真实搜索留 25）
- [ ] `pnpm -r test` 全绿；新增至少 5 个测试（api.ts 轮询、Tree 组件、routing 解析、workspaces sidebar 渲染、Timeline 渲染空态）
- [ ] `pnpm lint` clean

# Plan

- [ ] T1 Vite + React + TS 骨架
  - `packages/ui/package.json` 加 `react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`lucide-react`；devDep `@types/react`、`@types/react-dom`
  - `vite.config.ts`（`build.outDir='dist'`、`base='./'` for asset paths in hash route）
  - `src/main.tsx`、`src/App.tsx`、`index.html` 模板
  - tsconfig.json：`"jsx": "react-jsx"`、`rootDir=src`
- [ ] T2 Design token + base styles
  - `src/styles/tokens.css`（所有 Pencil 变量）
  - `src/styles/base.css`（reset、font、scrollbar）
  - `index.html` 预加载 Inter + JetBrains Mono（Google Fonts 或本地）
- [ ] T3 Layout primitives：TopBar / StatusBar / Sidebar / ThreePane / Inspector
  - 每个组件单独 `.tsx` + `.module.css`
- [ ] T4 UI primitives：Card / Button / IconButton / Badge / Pill / Tabs / Tree / Hunk
- [ ] T5 hash router (`src/router/`) + 路由表 + 面包屑生成
- [ ] T6 `src/api.ts` + `usePoll` hook；5s 轮询 `/api/health` & `/api/queue-stats`
- [ ] T7 WorkspacesSidebar 组件 + 数据绑定
- [ ] T8 TimelinePage（vanilla 版本等价重写）
- [ ] T9 Stub pages（Workspace / Session / Review / Replay / Blame）— 每个显示页名 + route params + "coming in card 2X"
- [ ] T10 Collector 改动：
  - 新 `/api/workspaces` 端点（SELECT DISTINCT workspace_id 聚合）
  - 新 `/api/queue-stats` 端点（扫 queue 目录）
  - 新 `getLegacyAppHtml()` + `GET /legacy/` 路由
  - `getAppHtml()` 改读 `dist/index.html`，静态 `/assets/*` 路由
- [ ] T11 UI build 集成：`ui/scripts/copy-html.mjs` 调整为 copy 整个 `dist/` 到目标位置
- [ ] T12 测试：T10 新 API 两个、T7 Sidebar、T8 Timeline、T6 usePoll、T5 router 解析
- [ ] T13 docs：`specs/ui.md` 重写（routes + primitives + token 清单）；README 更新"Running the UI"段
- [ ] T14 close → 归档

# Risks and Rollback

- **Risk 1**: Vite dev server 行为和 production bundle 不一致（CSS 作用域、asset URL）。Mitigation: 只跑 `pnpm build` + `minspect serve`（production 模式），不做 Vite dev server 集成；问题反馈快。
- **Risk 2**: `base: './'` 在 hash router 下 asset URL 是否正确解析。Mitigation: T1 完成后立即端到端验证一次访问 `/` + `#/ws/xxx` 路由下 JS/CSS 加载正常。
- **Risk 3**: React 18 严格模式下 `useEffect` 触发两次 → 轮询重复。Mitigation: `usePoll` 内部用 ref 去重 cleanup。
- **Risk 4**: Fonts 加载慢导致 FOUT 闪烁。Mitigation: `font-display: swap`、先用 system monospace 直到加载完成。
- **Rollback**: 用户访问 `/legacy/` 拿回原 UI；或者把 `getAppHtml` 改回读 `legacy-app.html`，redeploy。不删除 vanilla HTML 保底。

# Notes

- 字体托管：先用 Google Fonts CDN；如果离线使用有人抱怨，后续卡切换成本地打包。
- CSS Modules vs Tailwind：选 CSS Modules。Tailwind 对当前非营销向 UI 收益低于学习成本。
- 状态管理：**不引入 Redux/Zustand**。React Context + `usePoll` 对 minspect 这种"单用户纯 view"体量足够。
- ⌘K palette 在本卡只占位 `alert('coming soon')`，真实搜索在卡 25 做。
- Pencil 文件 `new.pen`（桌面画布中 5 张 artboard）作为视觉规范；实现时偏差以 Pencil 为准。
- 不做 legacy UI 的自动切换按钮——希望鼓励用户迁移新 UI；/legacy/ 只是"万一出问题"的逃生舱。

## Execution notes (2026-04-28)

- **Build pipeline**：Vite outDir 指到 `dist/spa/`，tsc lib 继续写 `dist/index.js` 走 `tsconfig.lib.json`，两者互不干扰。`getAppHtml()` 读 `./spa/index.html` 相对自身位置。
- **a11y 折腾**：Biome 的 `noNoninteractiveTabindex`、`useSemanticElements`、`useKeyWithClickEvents` 三条规则把"div+onClick"模式全拦下。最后把 TimelinePage / WorkspacesSidebar / Tree 的 clickable 行都换成 `<button>` + `all: unset` 样式。代价：`<button>` 默认 `display:inline-block`，要手 `display:flex; width:100%` 拉回去。
- **`usePoll` StrictMode 陷阱**：`tick` state 当刷新触发器会被 `useExhaustiveDependencies` 警告。改用 `runRef` ref 模式 —— effect 暴露 run 函数给外部 `refetch()` callback，不进 deps array。
- **Smoke test 踩坑**：第一次 `minspect serve` 复用了之前进程的 daemon（PID 2136，跑的是旧代码），所有新路由都 404。`minspect stop` 后重启才生效。正式文档应该提醒用户 build 后要 restart daemon。
- **CSS @fontsource 包体积**：inter + jetbrains-mono latin + latin-ext + cyrillic-ext 各 3 weight = 约 27 个 woff2/woff 文件，但 Vite 只在首次用到时加载对应语言集，实际冷启动 ~50ms。
- **Bundle size**：gzipped JS **51 KB**，CSS 23 KB。远低于 200 KB 目标。

## Check

- `pnpm -r build` 8 包全绿
- `pnpm -r test` **187 tests pass**（卡前 170，+17 新：UI 13 + collector 4）
- `pnpm exec biome check .` clean
- 端到端 smoke：`minspect serve` → `curl /` 返回新 React shell ✓ `curl /legacy/` 返回 vanilla ✓ `curl /api/workspaces` 返回 3 workspace 的真实聚合 ✓ `curl /api/queue-stats` 返回 `{queue:0, poisoned:111}` ✓
- 浏览器手验：打开 `http://127.0.0.1:<port>/` 看到新 shell（topbar + workspaces sidebar + timeline 页 + statusbar）；点左侧 workspace → 导航到 `#/ws/<path>`；statusbar 数字每 5s 刷新。

## Close

- `specs/ui.md` 全部重写（旧 Scope MVP 段删掉，改为 React + primitives + 新 endpoints 清单）
- 卡 23/24/25 已开 stub 待 apply
- legacy HTML 保留在 `src/legacy-app.html`，`/legacy/` 路由随 build 一起生效
- 卡归档
