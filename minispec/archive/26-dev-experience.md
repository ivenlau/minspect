---
id: 26-dev-experience
status: closed
owner: ivenlau
closed_at: 2026-04-28
spec: cli
---

# Why

三个反复踩的坑：
1. UI build 后要手动 `minspect stop && minspect serve`，否则老进程还在跑旧代码（卡 22 close 时两次中招）
2. UI bundle 更新了浏览器没刷，但没有任何提示（本地开发和自用都看不到）
3. `findRunningDaemon` 只靠 PID `kill(0)` + `/health`，一旦 daemon 跑老代码也通过验活，用户继续访问错的 API

本卡把"开发者一碰就踩"的问题一次性抹掉。

# Approach

三个独立小改，打包在一卡：

1. **`minspect serve --watch`**：chokidar 监听 `@minspect/ui/dist/spa/`，变更时 in-process 重新 `close()` + `createServer` + `listen`（保持 port）。不引入新进程。
2. **Build version sync**：collector `GET /api/build-info` 返回 `{ui_hash, server_hash}`（hash 是 `dist/spa/index.html` sha256 前 8 位 + `@minspect/collector` package.json version）。UI `StatusBar` 在启动时 fetch 一次，轮询每 30s，不匹配时在 statusbar 右侧加一个黄色 "Reload (UI updated)" 链接。
3. **Strict daemon detection**：`runServe` 启动前对现有 daemon 多做一步 `GET /api/build-info`，版本不匹配就 stop 再 serve，不再复用。

# Scope

- In:
  - `packages/collector/src/server.ts`：`/api/build-info` 端点
  - `@minspect/ui/getBuildHash()`：新导出，读 `dist/spa/index.html` + sha256 前 8 位
  - `packages/cli/src/commands/serve.ts`：`--watch` flag 逻辑（chokidar 轮询 200ms，防抖）+ 启动前的严格验活
  - `packages/ui/src/layout/StatusBar.tsx`：加 version mismatch 提示
  - 测试：build-info 端点一个，getBuildHash 一个
- Out:
  - Vite dev server proxy 集成（keep cold-build 路径，不引 vite-in-serve）
  - Hot reload 的 WebSocket（太重，手动 F5 够用）
  - 跨平台进程管理抽象

# Acceptance

- [ ] `minspect serve --watch` 跑起来后，`pnpm -C packages/ui build` 在 1s 内触发 daemon in-process 重载，浏览器 F5 能看到新 JS
- [ ] UI 跑旧 bundle 时 statusbar 右侧出现黄色 "Reload" 提示
- [ ] `minspect serve` 检测到老版本 daemon 在跑 → 自动 stop + start，不再复用
- [ ] `pnpm -r test` 全绿 + biome clean

# Plan

- [ ] T1 `getBuildHash` 函数 + test
- [ ] T2 `/api/build-info` endpoint + test
- [ ] T3 `serve.ts` 加 `--watch` (chokidar debounced, 200ms) + strict daemon check
- [ ] T4 StatusBar version mismatch 提示
- [ ] T5 specs/cli.md + specs/ui.md 小更新
- [ ] T6 close

# Risks and Rollback

- Risk: `--watch` 在 Windows 上文件锁问题。Mitigation: 先 close 再重建 Store，chokidar 加 awaitWriteFinish。
- Rollback: 删 `--watch` flag；build-info 端点留下（无负作用）。

# Notes

- chokidar 依赖 150 KB，可接受
- Build hash 不用 git commit —— 避开干净/脏工作区差异

## Execution notes (2026-04-28)

**Scope 调整**：原本计划的 `--watch` flag 砍掉了。原因：
- `@fastify/static` 已经每次请求都从磁盘读，Vite 重 build 不需要重启 server
- `getAppHtml()` 同样每次调用都重读，HTML shell 自动拿到新版
- 真实痛点是"daemon 进程本身跑老代码"（handlers 在内存里），而这只有重启才能解
- `--watch` 的"自动触发 `pnpm build` on source change" 是 dev-server 方向，越做越大；留给未来有需要再开

**落地的 3 件事**：
1. `getBuildHash()` 函数：sha256 of `dist/spa/index.html` 前 12 hex（给 UI 做 stale-tab 检测）
2. `GET /api/build-info`：返回 `{ui_hash, server_started_at, server_code_mtime}`。`server_code_mtime` 是 daemon 启动时 stat 自己 entry module 的 mtime
3. `runServe` strict reuse：找到现有 daemon 后先 fetch `/api/build-info`，再和本地 `stat(collector/dist/index.js).mtimeMs` 对比。磁盘 > daemon + 1s → 判定 stale → kill + restart + bind 新 port
4. `StatusBar` 在浏览器端：首次 poll 记住 ui_hash，后续 poll 发现变化时显示黄色 "↻ reload (UI updated)" 按钮

**踩的坑**：
- `getBuildHash()` 在 CLI 那边没用武之地 —— CLI 和 daemon 读同一个 `dist/spa/index.html` 文件，永远匹配。最终靠 `server_code_mtime` + 本地 fs.stat 对比才是有效检测
- `createRequire(import.meta.url).resolve('@minspect/collector')` 在 vitest 环境下会抛 "No exports main defined"。换成按 dist 相对路径解析（`../../../collector/dist/index.js`）

## Check

- `pnpm -r test` 212 tests pass（collector +1 build-info endpoint test）
- `pnpm exec biome check .` clean
- 端到端：`serve` + `touch collector/dist/index.js` + 重 invoke `serve` → 日志 "running stale code; restarting..." + 新 port bind

## Close

- `specs/cli.md` `minspect serve` 条目加"版本自检：磁盘代码比 daemon 新 → 自动 kill + restart"一句
- 卡归档
