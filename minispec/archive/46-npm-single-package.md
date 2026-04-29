---
id: 20260429-npm-single-package
status: closed
owner: ivenlau
---

# Why

当前用户要 clone 源码 + 装 pnpm + `pnpm -r build` + `pnpm link --global`
才能用。换成 `npm i -g minspect` 一条命令装完。对 CLI 生态用户是最熟的预
期；对 `minspect init` 体验也是关键前置（README 那行从 3 行压到 2 行）。

# Approach

- Considered:
  - 发 workspace 里每个子包（`@minspect/core`、`@minspect/cli` 等），cli
    依赖其它。生态标准但 publish 顺序、版本同步麻烦；用户装的时候要知道装
    哪个。
  - 发单包 `minspect`（非 scoped），bundle 所有 workspace 产物进一个 npm
    tarball。用户只需 `npm i -g minspect`。
- Chosen: 单包 `minspect`（按用户选）。`better-sqlite3` 是 native 依赖保留
  为外部（`npm i` 时按平台编译）；UI dist + 其它 TS 代码一律打进 tarball。

# Scope

- In:
  - 根 `package.json` 或 `packages/cli/package.json`：
    - 包名改为 `minspect`（非 scoped），`bin: { minspect: "./dist/bin.js" }`
    - `files: ["dist/**"]`；UI 产物在 publish 前复制到 `dist/ui/`
    - `prepublishOnly`: `pnpm -r build && node scripts/bundle.mjs`
    - `publishConfig: { access: "public" }`
  - `packages/cli/scripts/bundle.mjs`（esbuild）：
    - entry `src/bin.ts`, bundle workspace packages `@minspect/*` 进去
    - external: `better-sqlite3`（native）+ `fastify`（大但可打进去，由
      bundle size 决定；initially 打进去）
    - output `dist/bin.cjs`；更新 `dist/bin.js` shebang wrapper 指过去
  - UI 静态资源复制：`cp -r packages/ui/dist/spa packages/cli/dist/ui`。
  - `install.ts`：生成的 hook command 从"absolute path to bin.js"改成
    `minspect capture`（假设 npm i -g 后 minspect 在 PATH）。
  - CI publish workflow（手工 trigger，`--dry-run` 跑通）。
  - `.npmignore`: 排源码 / tests / fixtures。
- Out: 多包独立发布；Bedrock / Foundry / 第三方集成。

# Acceptance

- [ ] Given `npm pack` 在本地, Then 出 `minspect-<v>.tgz`，`tar -tf` 里
      无 `src/` / `*.test.ts`。
- [ ] Given `npm i -g ./minspect-<v>.tgz`, Then `minspect --version` 输出；
      `which minspect`（or Windows `where minspect`）在 PATH 里。
- [ ] Given 安装后, When `minspect serve`, Then UI 静态资源可访问（`/assets/*`
      返回 200）。
- [ ] Given 安装后 `minspect install --agent claude-code`, Then settings.json
      里 hook command 为 `minspect capture` 而非 node 路径。
- [ ] Given tarball size, Then < 10 MB（不含原始 fonts 冗余；UI 产物已 gzip
      友好）。
- [ ] Given CI smoke test, Then `npm pack` → `npm i -g tarball` →
      `minspect --version` → `minspect doctor --json` 全 green。

# Plan

- [ ] T1 `scripts/bundle.mjs`：esbuild bundle workspace；external 列表按
      size 决定。
- [ ] T2 `packages/cli/package.json` 改名 + `files` + `publishConfig` +
      `prepublishOnly`。
- [ ] T3 UI 产物复制步骤（bundle 脚本或独立 `copy-ui.mjs`）。
- [ ] T4 `install.ts` hook command 改 `minspect capture`；旧"node absolute
      path" 路径保留作 fallback（检测 PATH 里无 minspect 时）。
- [ ] T5 `.npmignore` 或 `files` 白名单。
- [ ] T6 CI workflow（`.github/workflows/release.yml`）：手工 trigger →
      build → `npm pack` → artifact upload（publish 先手工）。
- [ ] T7 README Quick start 重写为 `npm i -g minspect && minspect init`。
- [ ] T8 `minispec/specs/cli.md` + 新 `minispec/specs/packaging.md`（如
      果要独立 domain）。

# Risks and Rollback

- Risk: `better-sqlite3` 在 Windows 需要 `node-gyp` + VS build tools；失败
  率偏高。缓解：`better-sqlite3` 自带 prebuilt binaries for major platforms
  (`prebuild-install`)，大多数情况 `npm i` 不编译；README 加"如果失败装 VS
  Build Tools"提示。
- Risk: 旧用户脚本 / 文档仍引用 `@minspect/cli`。缓解：短期可以 dual-publish
  `@minspect/cli`（legacy）指向同一 tarball；README 说明迁移。
- Risk: tarball 过大（UI 字体占 1+ MB）。缓解：publish 前跑 bundle 分析，
  必要时移除多余字体变体。
- Rollback: `npm unpublish minspect@<v>`（24h 内），或发 deprecate + 撤回指
  引。

# Notes

- 这张卡依赖 40–45 完成后再发 v0.1.0，否则首发体验不连贯。
- 卡 47 一键安装脚本的二进制产物走另一路径（pkg/bun），但 npm 包是主分发渠
  道。
