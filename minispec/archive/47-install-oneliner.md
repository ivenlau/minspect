---
id: 20260429-install-oneliner
status: closed
owner: ivenlau
---

# Why

对"不想装 Node"的用户，`curl ... | sh` / `iwr ... | iex` 是最熟的预期。补一
个自包含二进制 release 的 one-liner 通道，覆盖非 Node 受众。

# Approach

- Considered:
  - curl / PowerShell 脚本下载 GitHub Release 预构建二进制（pkg 或 bun
    build 生成的 `minspect-<os>-<arch>`），放到 `/usr/local/bin` 或
    `%LOCALAPPDATA%\Programs\minspect\`，改 PATH。
  - Homebrew tap（mac / linux）+ Scoop bucket（Windows）：维护成本高，早期
    社区体量小收益低。
  - apt / yum 仓库：进一步下游，不做。
- Chosen: curl + PowerShell 脚本 + release CI 出 3 个平台二进制（pkg 或
  bun，按实测选）。

# Scope

- In:
  - `scripts/install.sh`（bash，macOS + Linux，支持 x64/arm64 探测）
  - `scripts/install.ps1`（Windows）
  - GitHub Actions release workflow：打 tag 时构建 `minspect-{darwin,linux,win32}-{x64,arm64}`
    artifact，上传到 Release。
  - README "Install" 章节加 "No Node? One-liner:"
    ```bash
    curl -fsSL https://raw.githubusercontent.com/.../install.sh | sh
    # PowerShell
    iwr https://raw.githubusercontent.com/.../install.ps1 | iex
    ```
  - 脚本支持 `--version <v>` 固定版本；幂等（重入升级到最新）。
- Out: 跨包管理器发布（brew / scoop / apt）；自动更新（脚本只安装）。

# Acceptance

- [ ] Given mac/linux, When `curl ... | sh`, Then `minspect --version`
      可用；`minspect init` 可跑完整流程。
- [ ] Given Windows, When `iwr ... | iex`, Then 同上；PATH 持久化。
- [ ] Given 重入脚本, Then 覆盖 + 更新到 latest（或 `--version`）。
- [ ] Given 无 Node 的机器, Then 一切仍能跑（二进制自包含 Node runtime）。
- [ ] Given 二进制大小, Then ≤ 40 MB（pkg 的 Node 约 35 MB；bun 约 20-30
      MB）。

# Plan

- [ ] T1 评估 pkg vs bun build 的产物大小、启动速度、跨平台完整度，选定
      打包器。
- [ ] T2 GitHub Actions release workflow：matrix `os × arch`，artifact 上
      传到 Release。注意 `better-sqlite3` native binding：pkg 要用
      `--public-packages=*`；bun 要确认 native module 支持。
- [ ] T3 `install.sh`：探 OS/arch → 下对应二进制 → 放 `/usr/local/bin` 或
      `$HOME/.local/bin` → 提示 PATH。
- [ ] T4 `install.ps1`：下 Windows binary → 放 `%LOCALAPPDATA%\Programs\minspect`
      → 加 PATH（用户级环境变量）。
- [ ] T5 README "Install" 章节重写，提供两种路径（npm / 二进制 one-liner）。
- [ ] T6 Release checksum（SHA256）校验，脚本里 verify。

# Risks and Rollback

- Risk: `better-sqlite3` 是 native C++，打进 pkg/bun 复杂度高可能跑不起来。
  缓解：T1 阶段先验证 smoke；若卡住，退一步用 Node 18+ 最小 tarball 模式
  （不走 pkg，脚本直接安装 Node + npm package）。
- Risk: 二进制过大 → 下载体验差。缓解：bun 或 pkg `--compress` 减 30%。
- Risk: 国内 GitHub Releases 下载慢。缓解：README 提供备选镜像链接（jsdelivr
  或 ghproxy）。
- Rollback: 删 release CI step + README 章节；npm 路径继续主分发。

# Notes

- 本卡依赖卡 46 的打包产物（实际上 one-liner 下载的就是 bundle 出来的二
  进制）；46 完成前不开。
