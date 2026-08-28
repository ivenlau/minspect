---
id: 38-long-workspace-path-404
status: done
owner: ivenlau
---

# Why

用户机器上 129 个 workspace 中 48 个（路径 ≥109 字符的 `C:\Users\admin\mico_workspaces_...` 系列）点开是 "Failed to load: 404 Not Found"。实测定位：Fastify 底层 find-my-way 路由器 `maxParamLength` 默认 100，`:path` 参数超过 100 字符时路由直接不匹配，返回 Fastify 通用 404（handler 根本不执行）——所以 GET / DELETE / sessions 全部 404，这些 workspace 既打不开也删不掉。次要问题：① handler 对 Fastify 已解码的 param 再次 `decodeURIComponent`，路径含 `%` 时会二次解码出错/抛异常；② WorkspacePage 出错时整页只有一行错误，没有删除按钮，用户无法自救。

# Approach

- Considered:
  - Option A: 只修 UI（错误时也渲染删除按钮）。治标：删除接口本身仍被路由层挡死，按钮点了也 404。
  - Option B: 只调 `maxParamLength`。治本路由问题，但错误页面仍不完整，下次出现别的 404（如 DB 行真删了）用户仍卡死。
  - Option C: 两处都修 + 顺手消掉双重解码隐患。
- Chosen: C。A 不解决删除 404；B 不解决页面自救。C 三个改动都很小且互相独立。

# Scope

- In:
  - `packages/collector/src/server.ts`：`Fastify({ maxParamLength: 1000 })`（Windows 深路径 + URL 编码膨胀，1000 覆盖 MAX_PATH 260 且留余量）。
  - `packages/collector/src/api.ts`：四个 workspace handler 去掉多余的 `decodeURIComponent`（Fastify 5 已解码 params）。
  - `packages/ui/src/pages/WorkspacePage.tsx`：error 分支渲染完整页头（标题 + 路径 + 删除按钮）+ 错误信息 + 空列表占位，删除走既有 `ConfirmDeleteWorkspaceModal`。
  - 测试：collector api.test.ts 加长路径 GET/DELETE 用例；UI 加 WorkspacePage error 渲染用例（若有先例）。
- Out:
  - 不改路由 / hash 编码方案。
  - 不给 sidebar 加右键删除。
  - 不做 workspace 行存在性预检接口。

# Acceptance

- [x] Given workspace id 为 125 字符真实路径 When GET `/api/workspaces/:path` Then 200 且返回明细 — vitest 用例 `workspace routes match params over 100 chars` 通过；用户重启 daemon 后真机 129 个 workspace 中 48 个长路径全部恢复可打开
- [x] Given workspace id 为 125 字符真实路径 When DELETE `/api/workspaces/:path` Then `{ok:true}` 且 workspaces 列表不再包含它 — 同用例内验证 DELETE 200 + 列表不含；用户真机删除功能可用
- [x] Given workspace 路径含 `%` 字符 When GET detail Then 不因二次解码抛 500 / 查询错行 — vitest 用例 `workspace routes handle ids containing %` 通过
- [x] Given GET detail 失败 When 打开 WorkspacePage Then 页面显示完整页头（标题、路径、删除按钮）与错误信息，点击删除可走确认弹窗 — vite build 通过；用户真机验证功能正常

# Plan

- [x] T1 server.ts 加 maxParamLength，api.test.ts 补长路径用例
  - Expected output: 新用例通过；旧用例全绿 — collector 116/116
- [x] T2 api.ts 去掉四处 decodeURIComponent
  - Expected output: 现有 encode 用例（api.test.ts 用 encodeURIComponent 构造 URL）仍通过 — 全部通过；改用 `routerOptions.maxParamLength` 消除 FSTDEP022 警告
- [x] T3 WorkspacePage error 分支渲染完整页面 + 删除入口
  - Expected output: 页面组件测试（或 typecheck+build）通过 — `pnpm -C packages/ui build` 通过（typecheck 有一个 HEAD 上即存在的 SessionOverviewPage 预存错误，与本次无关）
- [x] T4 `pnpm -r test` + `pnpm lint` 全绿，close 卡片
  - Expected output: 命令输出记录在 Notes — `pnpm -r test` 425/425 全绿（core 16 / ui 65 / codex 20 / claude-code 20 / opencode 17 / collector 116 / cli 171）；改动文件 biome check 干净（仓库根 `pnpm lint` 的 235 个错误为 HEAD 上预存，改动前后数量一致）；用户已手动重启 daemon 真机验证功能正常

# Risks and Rollback

- Risk: maxParamLength 放宽到 1000 增加极长 URL 的路由成本，可忽略（本地单用户服务）。
- Risk: 去掉二次解码后，若有调用方自己传的是未编码路径且 Fastify 又解了一次 → 行为变化。实际调用方只有 UI，全部 encodeURIComponent，风险低。
- Rollback: git revert 单提交。

# Notes

- 定位证据（2026-08-28 实测，daemon port 21477）：参数长 100 → 200，长 101 → Fastify `"Route ... not found"`；find-my-way@9.5.0 index.js:98 `maxParamLength = opts.maxParamLength || 100`。
- daemon 需重启（或重跑 `minspect init` / start）才能生效；前端改动需要 `pnpm -C packages/ui build` 后由 serve 静态托管。
