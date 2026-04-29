---
id: 49-install-quieter
status: closed
owner: ivenlau
depends_on: [47-install-oneliner]
---

# Why

`iwr ... | iex` / `curl ... | sh` 装 minspect 时 npm 喷一堆 transitive 依赖
的 warn：`peerOptional tree-sitter@^0.21.0 from tree-sitter-typescript` /
`deprecated prebuild-install@7.1.3`。都是上游依赖的事，用户看了没法做
任何事，反而掩盖真实错误。第一次用就被这一屏红黄字迎接，观感差。

# Approach

- Considered:
  - A. 保持现状 + README 加段"这些 warn 正常"：零改动，继续劝退。
  - B. 直接把 `npm install` 的 stderr 整个重定向到 `/dev/null`：简单但
    真正报错也会被吞掉，用户装失败都不知道。
  - C. `npm install --loglevel=error`：npm 内置分级，`error` 保留错误、
    隐藏 warn/notice/info；配合 `--verbose` 开关给排障留后门。
- Chosen: **C**。npm 原生支持，无需 shell 过滤 / grep 脆弱匹配。默认
  安静，加 `--verbose` / `-Verbose` 就回到 `notice` 级别看全。

# Scope

- In:
  - `scripts/install.sh`：新增 `--verbose` 参数；默认 `npm install -g
    ... --loglevel=error`；`--verbose` 切到 `--loglevel=notice`。
  - `scripts/install.ps1`：新增 `-Verbose` switch（非 CmdletBinding，
    不会跟 PS 通用参数冲突）；语义同上。
  - `packages/cli/src/install-scripts.test.ts`：新增断言 —— 两边都接受
    verbose 开关 + 默认 `--loglevel=error`。
  - `README.md` / `README.zh.md`：Quick start 段尾提一句"加 `--verbose`
    可看完整 npm 输出"。
- Out:
  - 不碰 npm 本身的 progress bar（npm 10 在非 TTY 下自动关，TTY 下留
    着也无妨）。
  - 不过滤具体 warn 文本（脆弱 + 不通用）。
  - 不做 `--quiet` 更安静的层级（`error` 已经是合理下限）。

# Acceptance

- [ ] Given `iwr ... | iex` 或 `curl ... | sh`, When 安装成功, Then
      stderr 不出现 `npm warn` / `npm notice` / `npm deprecated` 文字，
      只剩我们脚本自己的 `Installing ...` / `minspect installed:` 行。
- [ ] Given npm 真实失败（如 Node 19、网络断），Then 错误信息完整可见，
      脚本 exit 非 0。
- [ ] Given `--verbose` / `-Verbose`, Then 完整的 warn/deprecated 行都
      打出来，方便排障。
- [ ] `install-scripts.test.ts` 6 原 + 2 新 = 8 用例全绿（sh/PS 语法
      解析、两个参数断言、默认 loglevel 断言）。

# Plan

- [ ] T1 `scripts/install.sh`：
      - `VERBOSE=0` 默认
      - case 分支加 `--verbose) VERBOSE=1; shift ;;`
      - 装前 `NPM_LOGLEVEL=$( [ "$VERBOSE" = "1" ] && echo notice ||
        echo error )`
      - `npm install -g "$PKG" --loglevel="$NPM_LOGLEVEL"`
      - 帮助文字 `sed -n '2,21p'` 行号区间若改动顺带调整。
- [ ] T2 `scripts/install.ps1`：
      - `[switch]$Verbose` 加到 param
      - `$npmLogLevel = if ($Verbose) { 'notice' } else { 'error' }`
      - `npm install -g $pkg --loglevel=$npmLogLevel`
      - 顶部注释 flag 列表补 `-Verbose`。
- [ ] T3 `install-scripts.test.ts`：
      - 新增用例 "both accept --verbose / -Verbose"：断言
        `sh` 里有 `--verbose`、`ps` 里有 `[switch]$Verbose`。
      - 新增用例 "both default npm to --loglevel=error"：断言
        两份脚本都出现 `--loglevel=error` 字面（或 `$npmLogLevel` /
        `$NPM_LOGLEVEL` 变量路径，要抓得到默认分支就行）。
- [ ] T4 README Quick start 加一句：
      > 安装默认只打印错误。加 `--verbose`（PS: `-Verbose`）看 npm
      > 完整输出，用于排障。

# Risks and Rollback

- Risk: `--loglevel=error` 可能把"有用的 notice"（新版本可用、funding）
  也一起吞掉。缓解：funding 提示对一次性一行安装没意义；`--verbose`
  是逃生口。
- Risk: PS 的 `-Verbose` 在非 CmdletBinding 脚本里理论上不会触发
  PowerShell 通用 -Verbose 行为，但不同 PS 版本测试覆盖不足。缓解：
  `install.ps1 parses under PowerShell` 测试仍会捕获语法错。若真冲突
  重命名 `-ShowWarnings`。
- Rollback: 两个脚本把 `--loglevel=...` 去掉即可恢复原行为；测试断言
  同步删。

# Notes

- 这张卡跟版本号 0.1.1 发布一起落地：`packages/cli/package.json`
  0.1.0 → 0.1.1（修 init detach + install 静默），作为首个打补丁版本。
