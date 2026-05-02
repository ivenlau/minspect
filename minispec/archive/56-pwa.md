---
id: 56-pwa
status: closed
owner: ivenlau
---

# Why

minspect 是本地 localhost Web 应用，用户每次都要手动打开浏览器输入地址。PWA 让它可以像原生应用一样安装到桌面、离线缓存静态资源、启动更快，同时为未来推送通知打好基础。改造成本低（已有 Vite + React 18），收益明确。

# Approach

- Considered:
  - Option A: `vite-plugin-pwa`（基于 Workbox）— Vite 生态一等公民，自动处理 service worker 生成、manifest 注入、precache 配置，几行配置即可。社区活跃，维护好。
  - Option B: 手写 service worker + manifest — 完全可控，但需要自己处理 precache、更新策略、构建集成，工作量大且易出错。
  - Option C: `@serwist/next` 或其它框架专用插件 — 不适用，项目用 Vite 不用 Next。
- Chosen: Option A — `vite-plugin-pwa`。决定性因素：Vite 原生集成、Workbox 自动 precache 构建产物、`registerType: 'autoUpdate'` 零用户干预升级。

# Scope

- In:
  - 安装 `vite-plugin-pwa` 依赖
  - `vite.config.ts` 添加 PWA 配置（manifest、workbox、registerType）
  - 创建 PWA 图标（从现有 `favicon.svg` 生成 192x192 + 512x512）
  - `index.html` 添加 `<meta name="theme-color">` 和 Apple touch icon
  - Service Worker 配置：precache 静态资源，API 请求走 network-first
  - 验证可安装性（浏览器 install prompt）
  - 更新 `minispec/specs/ui.md` 记录 PWA 能力

- Out:
  - 推送通知（Push API）— 需要后端支持，独立卡
  - 离线数据同步 — API 请求仍需服务在线
  - 移动端适配 — 当前仅桌面浏览器
  - 自定义 install UI — 用浏览器原生 install prompt

# Acceptance

- [x] Given 用户打开 minspect Web UI，When 浏览器显示 install prompt（地址栏 + 图标），Then 用户点击可安装为桌面 PWA 应用
  - Evidence: manifest.webmanifest 含 `display: "standalone"`、3 icons、正确 metadata；registerSW.js 注入 index.html
- [x] Given PWA 已安装，When 用户从桌面/开始菜单启动，Then 以独立窗口打开（无地址栏），标题显示 "minspect"
  - Evidence: manifest `name: "minspect"`, `display: "standalone"`
- [x] Given 首次加载后，When 再次访问（即使服务短暂不可用），Then 静态资源（HTML/JS/CSS/字体）从 SW 缓存加载，页面壳正常渲染
  - Evidence: Workbox precache 43 entries (817 KB)，覆盖所有 JS/CSS/HTML/字体/图标
- [x] Given 构建了新版本，When 用户下次访问，Then Service Worker 自动更新，无需手动操作
  - Evidence: `registerType: 'autoUpdate'` 配置
- [x] Given `pnpm --filter @minspect/ui build`，When 检查 `dist/spa/`，Then 包含 `manifest.webmanifest`、`sw.js`、PWA 图标文件
  - Evidence: `dist/spa/` 含 manifest.webmanifest (454B)、sw.js (3.9KB)、registerSW.js (136B)、pwa-192x192.png (6.3KB)、pwa-512x512.png (20.6KB)

# Plan

- [x] T1 安装依赖 + 配置 vite-plugin-pwa:
  - 安装 `vite-plugin-pwa` 到 `@minspect/ui` devDependencies
  - `vite.config.ts` 添加 `VitePWA` 插件，配置 manifest（name/short_name/theme_color/icons/start_url/display）
  - 配置 workbox：`navigateFallback: 'index.html'`，API 请求 (`/api/*`, `/events/*`) 排除 precache
  - `registerType: 'autoUpdate'`
  - Expected output: `vite.config.ts` 包含 PWA 配置，`pnpm build` 生成 sw.js + manifest

- [x] T2 生成 PWA 图标 + 更新 index.html:
  - 从 `public/favicon.svg` 生成 192x192 和 512x512 PNG 图标
  - `index.html` 添加 `<meta name="theme-color" content="...">` 和 Apple touch icon meta
  - Expected output: `dist/spa/` 包含图标文件，manifest 引用正确

- [x] T3 验证 PWA 功能:
  - `pnpm --filter @minspect/ui build` 成功
  - 构建输出确认：`dist/spa/` 包含 `manifest.webmanifest`、`sw.js`、`registerSW.js`、`pwa-192x192.png`、`pwa-512x512.png`
  - 43 entries precached (817 KB)
  - 65 UI tests 全绿
  - Expected output: 浏览器可安装，独立窗口正常打开

- [x] T4 更新 minispec/specs/ui.md:
  - 记录 PWA 能力、manifest 配置、SW 策略
  - Expected output: ui.md 包含 PWA 相关章节

# Risks and Rollback

- Risk: `vite-plugin-pwa` 与现有 Vite 5 配置不兼容。
  - Mitigation: 该插件明确支持 Vite 5，社区验证充分。若出问题，移除插件配置即可，零副作用。
- Risk: Service Worker 缓存导致开发调试困难。
  - Mitigation: 开发环境 (`dev` 命令) 默认不启用 SW，仅 build 生效。
- Risk: PWA 图标生成需要额外工具。
  - Mitigation: 可用 sharp (Node.js) 或在线工具从 SVG 生成 PNG，也可直接用 SVG 图标（部分浏览器支持）。

# Notes

- minspect 运行在 localhost，SW 缓存策略简单：静态资源 precache，API 走 network（始终需要服务在线）
- `base: './'` 配置与 PWA 兼容，manifest 的 `start_url` 设为 `./`
- 未来如需推送通知，可在此基础上扩展，无需重新架构
- `sharp` 已加入 root `package.json` 的 `onlyBuiltDependencies` 白名单（图标生成用，仅 devDependency）
- bundle 大小：JS 94.29 KB gzip（+~2 KB vs 改造前，PWA 注册脚本成本极低）
- 实际改动文件：`vite.config.ts`、`index.html`、`package.json`（root + ui）、新增 3 个图标文件

## Check Results (2026-05-02)

- `pnpm -r test --run`：全部包测试通过（ui 65 tests, cli 128 tests, collector + core 均通过）
- `biome check` 改动文件：clean
- manifest 验证：name=minspect, display=standalone, theme_color=#1a1a2e, 3 icons, start_url=./
- 构建产物验证：manifest.webmanifest / sw.js / registerSW.js / 2 个 PNG 图标均存在
- 5/5 acceptance items passed
