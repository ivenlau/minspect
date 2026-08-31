---
id: 20260831-sandbox-cli-tests
status: closed
owner: claude
---

# Why

CLI 测试套件在 Windows 上会打穿真实用户状态，今天已造成两起实际破坏：

1. 跑全量 `pnpm -r test` 后，真实 `~/.claude/settings.json` 的 minspect hook 被清、`~/.config/opencode/plugins/minspect.ts` 被删（17:42）。
2. 跑发布前套件后，HKCU Run 键的 `minspect-daemon` 值被真实 `reg delete` 删除（18:40），导致 20:19 重启后 daemon 无从自启（用户重启电脑后服务没起来，恢复后定位到本因）。

根因有两层：

- **环境重定向不完整**：测试用 `process.env.HOME` 重定向家目录，但 Windows 的 `os.homedir()` 读 `USERPROFILE`（`paths.ts` 的 state dir 回退读 `LOCALAPPDATA`）——凡是没有显式注入路径的用例（`init` 流程、`install/uninstall` 默认 user scope、`status/doctor` 的 hook 探测），都命中真实用户目录。
- **`uninstall.test.ts` 完全没 mock `child_process`**：`runUninstall({all: true})` 走到 `executeUninstallAutostart` → `removeScheduledTask` → **真实的 `reg delete HKCU\...\Run /v minspect-daemon /f`**。该命令不受任何 env 沙箱影响，env 重定向救不了它。

# Approach

- Considered:
  - Option A: 只给 `uninstall.test.ts` 补 `child_process` mock。trade-off: 堵住 reg delete 这一个洞，其余 homedir 打穿照旧。
  - Option B: 全局 vitest setupFile，把 `HOME` / `USERPROFILE` / `LOCALAPPDATA` / `XDG_STATE_HOME` / `XDG_CONFIG_HOME` 重定向到 per-run 临时沙箱 + 补 `uninstall.test.ts` mock。trade-off: 改动面稍大，但一次性让 CLI 套件在所有平台 hermetic。**Chosen**。
  - Option C: 给每处生产代码注入 homedir 依赖。trade-off: 侵入生产代码签名，改动面最大，收益相同。
- Chosen: Option B。CLI 套件是 `singleFork`（一个 worker），单个 setupFile 全程生效；per-case 的 `setHome`/XDG 覆盖依然在 setup 之后执行，语义不变。

# Scope

- In:
  - `packages/cli/test-setup.ts`（新）：mkdtemp 沙箱并设置上述 5 个 env。
  - `packages/cli/vitest.config.ts`：`test.setupFiles` 指向上者。
  - `packages/cli/src/commands/uninstall.test.ts`：补 `vi.mock('node:child_process')` 安全默认（`reg query` 抛"not installed"、其余 OS 调用返回成功缓冲）。
  - `minispec/specs/cli.md`（close 时）：测试 hermetic 约束一条。
- Out:
  - 生产代码签名改动（不注入 homedir）。
  - `stale state.json 抑制 hook auto-spawn` 的设计缺口（单独开卡）。
  - 其他包（core/collector/ui/adapters）的套件（本次破坏都来自 CLI 包）。

# Acceptance

- [x] Given Windows 上跑 `pnpm -C packages/cli test`，When 跑完，Then 套件全绿（25 files / 177 tests），且真实 `~/.claude/settings.json`、`~/.config/opencode/plugins/minspect.ts`、`HKCU\...\Run\minspect-daemon`、`%LOCALAPPDATA%\minspect\*` 的哈希/mtime 均未变化（sha256sum + stat + reg query 前后 diff 为空）。
- [x] Given `uninstall.test.ts` 的 `--all` 用例，When 执行，Then `reg`/`launchctl`/`systemctl` 调用全部命中 mock，无真实子进程（beforeEach 默认 mockImplementation + vi.mock 全文件生效；10 tests 绿）。
- [x] `pnpm -r test` 全绿（Windows）；`pnpm lint` touched files 0 error。

# Plan

- [x] T1 写 change card（本文件）
- [x] T2 新增 `packages/cli/test-setup.ts` + vitest.config setupFiles
- [x] T3 `uninstall.test.ts` 补 child_process mock
- [x] T4 Windows 全量套件 + hermeticity 探针验证
- [x] T5 close：更新 `minispec/specs/cli.md`，卡片归档

# Risks and Rollback

- Risk: 个别用例隐式依赖真实环境（如假设真实 `~/.claude/settings.json` 存在）→ 沙箱后断言翻转。
  - 缓解: 跑全量套件逐个修复；这类用例本来就是在真实环境才碰巧绿，属于既有缺陷。
- Risk: setupFile 的 env 改动影响同 worker 内后续模块加载顺序。
  - 缓解: CLI 套件 singleFork + setupFiles 在任何测试模块 import 前执行；生产代码均在调用时读 env。
- Rollback: revert 三个文件即可；沙箱仅存在于测试进程。

# Notes

- 事发记录：17:42 全量套件删 hooks；18:40 发布前套件删 Run 值（`reg delete`）；20:19 重启后无自启，20:3x 用全局 0.1.9 重装 autostart + wscript 拉起恢复（pid 20120）。
- `uninstall --all` 的 `stateRoot` 注入只隔离了 daemon-stop/config 写，autostart 的 `reg delete` 是 HKCU 固定路径，与 stateRoot 无关——必须 mock。
- 沙箱 mkdtemp per-run：singleFork 下全跑程共用一个；若未来改并行 worker，每 worker 各自 mkdtemp（setupFiles 每 worker 执行一次）。
