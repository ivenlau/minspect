---
id: 57-ci-publish
status: closed
owner: ivenlau
---

# Why

当前发布 `@ivenlau/minspect` 是手动三步：`pnpm -r build` → `pnpm -C packages/cli bundle` → `cd dist-bundle && npm publish`。流程繁琐、易忘步骤、无法追溯发布历史。需要 tag 触发的自动 CI publish，一条命令完成发布。

# Approach

- Considered:
  - Option A: GitHub Actions + tag 触发 — 项目已在 GitHub，生态成熟，免费额度充足，与 `gh release` 原生集成。
  - Option B: GitLab CI + tag 触发 — 需要迁移或双平台维护，无额外收益。
  - Option C: 本地脚本自动化（`release.mjs`）— 不依赖 CI，但不可追溯、不可审计、换机器需重新配置。
- Chosen: Option A — GitHub Actions。决定性因素：项目已在 GitHub，Actions 免费且与 npm/gh CLI 原生集成。

# Scope

- In:
  - `.github/workflows/publish.yml` — tag `v*` 触发的 CI workflow
  - 版本校验：CI 第一步检查 tag 版本 == `packages/cli/package.json` version
  - 完整构建链：`pnpm install` → `pnpm -r build` → `pnpm -C packages/cli bundle` → `pnpm -C packages/cli test`
  - `npm publish --access public`（从 `dist-bundle/` 目录）
  - `gh release create` 自动创建 GitHub Release（auto-generated notes）
  - 文档：README 或 CONTRIBUTING 中记录发布流程

- Out:
  - 自动 bump 版本号（保持手动更可控）
  - 跨平台 native binary 构建（当前通过 npm 依赖解决）
  - Homebrew tap / Scoop bucket（独立卡）
  - npm provenance / signed publish（后续可加）

# Acceptance

- [ ] Given 本地 push tag `v0.2.0`（且 `packages/cli/package.json` version 为 `0.2.0`），When CI 触发，Then `@ivenlau/minspect@0.2.0` 出现在 npm registry
- [ ] Given tag 版本与 package.json 版本不一致，When CI 触发，Then workflow 在校验步骤 fail，不执行 publish
- [ ] Given publish 成功，When 检查 GitHub Releases，Then 存在对应 tag 的 Release（auto-generated notes）
- [ ] Given `npm i -g @ivenlau/minspect@0.2.0`，When 运行 `minspect`，Then CLI 正常工作

# Plan

- [x] T1 创建 `.github/workflows/publish.yml`:
  - trigger: `push: tags: ['v*']`
  - job: `ubuntu-latest`, Node 20, pnpm (via `pnpm/action-setup`)
  - steps: checkout → pnpm install → version check → build → bundle → test → npm publish → gh release
  - secrets: `NPM_TOKEN`（npm auth）、`GITHUB_TOKEN`（release，自动提供）
  - Expected output: workflow 文件就绪，结构清晰，~50 行 YAML

- [x] T2 添加版本校验脚本（可选，workflow 内 inline）:
  - 比较 `git describe --tags --abbrev=0` 去掉 `v` 前缀 vs `packages/cli/package.json` version
  - 不一致则 `exit 1`
  - Expected output: workflow 中 version-check step

- [x] T3 本地 dry-run 验证:
  - `pnpm -r build` 全量构建通过
  - `pnpm -C packages/cli bundle` 打包通过
  - `pnpm -C packages/cli test` 128 tests 全绿（含 bundle 完整性测试）
  - Expected output: CI green

- [x] T4 更新文档:
  - `README.md` 新增 "Releasing" 章节（英文）
  - `README.zh.md` 新增 "发布" 章节（中文）
  - Expected output: 文档包含发布步骤说明

# Risks and Rollback

- Risk: `NPM_TOKEN` 未配置或过期导致 publish 失败。
  - Mitigation: workflow 中 npm publish step 加 `if: env.NPM_TOKEN != ''` 保护；fail 时可手动 publish 补救。
- Risk: tag 和 package.json 版本不一致导致发布错误版本。
  - Mitigation: CI 第一步严格校验，不一致直接 fail。
- Risk: GitHub Actions 服务不可用。
  - Mitigation: 手动流程作为 fallback（与当前方式一致）。

# Notes

- npm access token 需要在 GitHub repo Settings → Secrets → Actions 中配置 `NPM_TOKEN`
- 发布命令：`npm version 0.2.0 --no-git-tag-version && git add -A && git commit -m "release: v0.2.0" && git tag v0.2.0 && git push && git push --tags`
- workflow 使用 `pnpm/action-setup@v4` 自动安装 pnpm（版本从 `packageManager` 字段读取）
- `GITHUB_TOKEN` 自动提供，无需额外配置
- bundle 完整性测试（`bundle.test.ts`）已在 CI 中运行，确保产物质量
- workflow 共 7 个 step，~50 行 YAML
- 版本校验使用 `GITHUB_REF_NAME` 环境变量去掉 `v` 前缀与 package.json 比对
