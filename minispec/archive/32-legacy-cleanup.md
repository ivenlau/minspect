---
id: 32-legacy-cleanup
status: closed
owner: ivenlau
closed: 2026-04-28
---

# Why

新 React UI 从卡 22-25+polish 上线后跑了一段，没人报告 regression。`/legacy/` 路径的 vanilla HTML + `getLegacyAppHtml` + 相关路由都可以下线了 —— 少一份维护。

另外 `StubPage.tsx` 在所有 tab 实装后失去用途，可一并移除。

# Approach

按顺序删：vanilla HTML source → legacy 路由 → copy-legacy script → StubPage 组件 → 相关引用。

# Scope

- In:
  - `rm packages/ui/src/legacy-app.html`
  - `rm packages/ui/scripts/copy-legacy.mjs`（空目录也删）
  - `packages/ui/package.json` build 脚本移除 `copy-legacy`（变成 `tsc && vite build`）
  - `packages/ui/src/index.ts`：移除 `getLegacyAppHtml`
  - `packages/collector/src/server.ts`：移除 `/legacy/` 与 `/legacy` 两条路由 + import
  - `packages/collector/src/api.test.ts`：原 "GET /legacy/ returns vanilla HTML" 改成 "returns 404"
  - `rm packages/ui/src/pages/StubPage.tsx`
  - `App.tsx` 里 `'legacy-timeline'` / 默认 (not-found) 分支改用新 `EmptyState` + `lucide` icons（保留 route kind，bookmark 链接不至于彻底死）
  - 文档：specs/ui.md 的 Layout primitives table / endpoint table / Revert UI 说明 / changes 追加节
- Out:
  - Event schema 重构（无关）
  - 老 DB 数据 migration（只删代码，数据不动）
  - legacy-timeline **route kind**：保留用作软着陆，只是 body 不再显示 stub 而是 EmptyState

# Acceptance

- [x] build 产物不含 legacy-app.html（`find packages/ui/dist -name "legacy*"` 空）
- [x] `/legacy/` 返回 404（api.test.ts 新断言通过）
- [x] `getLegacyAppHtml` 不再 export（`packages/ui/src/index.ts` 已精简；collector `import` 删除）
- [x] `StubPage` 不再被 import（只剩 router 的 `legacy-timeline` kind，用 EmptyState 渲染）
- [x] tests + lint 全绿（213 tests 通过；biome check 160 files clean）
- [~] bundle size 降 ≥ 4 KB gzipped：**没达到**。实际 69.60 KB → 69.49 KB（≈ 100 bytes gzipped 减少）。StubPage 本身只 57 行 inline styles，App.tsx 的 stub 引用也很小。真正的瘦身其实是 server 端（不再 copy legacy-app.html 到 dist），对 client bundle 影响很小。这条 acceptance 预估过于乐观，实际收益主要在"少一份代码要维护"而非字节。

# Plan

- [x] T1 删 legacy HTML + script + getLegacyAppHtml + package.json build 脚本
- [x] T2 删 `/legacy/` 路由 + collector api.test.ts 对应用例改写
- [x] T3 删 StubPage + App.tsx 改用 EmptyState（legacy-timeline / not-found 两个分支）
- [x] T4 docs（specs/ui.md：Layout primitives 表格调整 + endpoint 表去 /legacy/ + Revert UI 去"/legacy/ 保底" + changes 追加 32 节）
- [x] T5 close

# Risks and Rollback

- Risk: 个别用户依赖 `/legacy/`。Mitigation: 新 UI 已上线一段时间无 regression 报告；实在需要可 git revert 这次 commit 恢复。
- Rollback: `git revert` 本次 commit；legacy-app.html 必须从 git history 找回。

# Notes

- 依赖卡 31 的 EmptyState 组件（已先 close）。
- router 的 `legacy-timeline` kind 保留：有人把 `#/session/:id` 旧链接发出去了，新 UI 要以 "Legacy link，Open the dashboard" 提示接住，而不是掉进 not-found 的一串 raw hash。
- 实测 bundle：旧 226.49 KB / 69.60 KB gzip → 新 226.52 KB / 69.49 KB gzip。JS 文件大小几乎不变（lucide-react 多进来两个 icon `Compass` / `Link2Off` 补偿了 StubPage 删除的空间）。CSS 完全一致（75.52 KB）。主要收益是少了 legacy-app.html 的磁盘复制 + `getLegacyAppHtml` 的 fs 读取路径。
