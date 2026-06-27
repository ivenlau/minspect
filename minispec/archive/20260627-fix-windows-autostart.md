---
id: 20260627-fix-windows-autostart
status: closed
owner: claude
---

# Why

`minspect install-autostart` 在 Windows 上 silently 失败，daemon 不会在用户登录后自动起来。诊断下来有四个相互牵连的 bug：

1. **Windows backend 选错原语**：`schtasks /Create` 在非 admin 用户的 ONLOGON 任务上必返回 "Access is denied"（任务计划程序的 ONLOGON 触发器需要 admin 串起 session-attached token），更早的 `/TR` 路径上还有引号转义、CLI parser 不遵守 `CommandLineToArgvW` 等坑。
2. **`init.ts:257` 在 install 失败时仍写 `autostart: true`**：把用户"想启用"和"实际装上"混为一谈。
3. **`status.ts` / `doctor.ts` 乐观判断**：在 Windows 分支不再 shell 出 `schtasks /Query`，直接 `unitPresent = enabled`，所以 install 即使失败也长期显示 `autostart: ✓`，用户被永久骗住。
4. **`scripts/dev-switch.ps1 local` 不重新注册**：开头 `uninstall --all --yes` 把任务删掉、把 config 写为 `autostart: false`，结尾的 `minspect init` 因为 `cfg.autostart !== undefined` 跳过 autostart 问句——任务从此再也没回来。

用户实际症状：电脑重启后 daemon 不起来。

# Approach

- Considered:
  - **Option A：把 Windows 任务名换无空格 + 手工转义 `/TR` 内嵌引号**。trade-off：依然走 `schtasks /Create` 的 CLI parser，对引号、空格、`/IT`、`/RL` 的处理在 PowerShell / Node `execFileSync` / cmd 三种入口下都不一致；继续踩坑。
  - **Option B：改用 `schtasks /Create /XML <file>`**。XML escaping 完备、CLI 只接受单文件路径；试运行时仍被 ONLOGON 的 admin 要求挡掉。trade-off：多一步写 tmp XML。
  - **Option C：放弃 Task Scheduler，改用 HKCU Run key**（`reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v minspect-daemon /t REG_SZ /d "..." /f`）。trade-off：reg.exe 也得处理 `\"` / `\\` 转义，但用户态、任何交互用户都能写，Explorer 在 logon 时 launch，与 ONLOGON 等价 UX。**Chosen**。
  - **Option D：Windows Service via `node-windows`**。需要 admin、引入依赖；与 launchd / systemd --user 语义不对称。
- Chosen: Option C + 顺手修另外三个 bug（init 失败-但写 true、status/doctor 乐观判断、dev-switch 不重注册）。

# Scope

- In:
  - `packages/cli/src/commands/autostart/scheduled-task.ts` 重写：把 `/XML` 路径替换为 HKCU Run key。`buildCommand(ctx)` 拼出 `"<node>" "<bin>" serve --quiet`（路径 `\` 和 `"` 各自转义）；`planScheduledTask` 的 `enable` = `reg add ... /f`、`disable` = `reg delete ... /f`、`isInstalled` = `reg query ... /v ...`；export `__testing__ = { escapeReg, buildCommand }` 给单测。
  - `packages/cli/src/commands/autostart/scheduled-task.test.ts` 重写：13 个 case 覆盖 `escapeReg`（`\` 和 `"`）、`buildCommand`（含空格的路径、内嵌 `"`）、`planScheduledTask`（`unitPath` / `unitBody` / `enable` args 形状 / `disable` args 形状 / `isInstalled` 两个分支）。
  - `packages/cli/src/commands/install-autostart.ts` "started" 探针：把 `schtasks /Query` 换成 `reg query`。
  - `packages/cli/src/commands/install-autostart.test.ts` Windows case 改写：mock 接受 `reg add`、断言 `unitPath` = `HKCU\…\Run\<name>`、断言 `/v minspect-daemon` / `/t REG_SZ` / `/d "<escaped command>"` / `/f`。
  - `packages/cli/src/commands/uninstall-autostart.test.ts` 默认 mock 改用 `reg query`（替代 `schtasks /Query`），保持 "未安装 → 抛错" 的语义。
  - `packages/cli/src/commands/init.test.ts` 默认 mock 改用 `reg query`；"install 失败" 用例的 mock 改为让 `reg add` 抛错。
  - `packages/cli/src/commands/status.ts:computeAutostartStatus` Windows 分支：实际 `reg query HKCU\…\Run /v minspect-daemon` 探 `unitPresent`（失败 → false）；`unitPath` 改为注册表路径字符串（不是 `\<task name>`）。
  - `packages/cli/src/commands/doctor.ts` Windows 分支：同上；`autostartUnitPathForPlatform` 返回注册表路径；message 文本 "task registered" → "value registered"。
  - `packages/cli/src/commands/autostart/index.ts`：头部注释 + `scheduledTaskName` 注释改为解释 HKCU Run key + 历史上 `schtasks` 命名的来由。
  - `packages/cli/src/config.ts` autostart 字段注释：把 "Task Scheduler / ONLOGON / /XML" 替换为 HKCU Run key 描述。
  - `packages/cli/src/commands/init.ts` autostart 块注释：从 "schtasks" 改为 "reg.exe"。
  - `scripts/dev-switch.ps1`：`uninstall --all` 之前备份 `<state_dir>/config.json` 的 `autostart` 字段；init 之后若备份值是 `true` 显式 `minspect install-autostart` 重注册（用 `node -e` 读 JSON，不引 jq 依赖）。
  - `minispec/specs/cli.md`：`install-autostart` / `uninstall-autostart` 命令行描述 + "用户态、无 sudo" canonical rule 改为反映 HKCU Run key，附 "为什么放弃 Task Scheduler" 一句话。

- Out:
  - 改 macOS / Linux 路径（launchd / systemd / XDG 都验证过 OK，本次 scope 不动）。
  - 重写 `install-autostart.ts` 的 orchestrator；只动 backend 实现 + "started" 探针。
  - 改 `uninstall-autostart.ts` / `uninstall.ts` 的命令面。
  - 改 i18n 键值（status / doctor 文案只在 CLI 输出，UI 没消费）。
  - 引入新依赖。

# Acceptance

- [x] Given Windows user runs `minspect install-autostart`，When 执行完成，Then `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v minspect-daemon` 返回 `minspect-daemon    REG_SZ    "<node>" "<bin>" serve --quiet`。
- [x] Given `minspect status` on Windows when value is present，When 命令跑完，Then 输出 `autostart: ✓  scheduled-task (HKCU\…\Run\minspect-daemon)`。
- [x] Given `minspect status` on Windows when value is missing，When 命令跑完，Then 输出 `autostart: ⚠ ...` 而非 `✓`，不再乐观撒谎。
- [x] Given `minspect doctor` on Windows when value is missing，When 命令跑完，Then autostart 行的 `status: warn` + `fix: re-run \`minspect install-autostart\``；CLI summary 出现 warn（不再 0）。
- [x] Given `minspect init --yes` in a directory where `runInstallAutostart` throws，When init 跑完，Then `<state_dir>/config.json` 的 `autostart` 字段是 `false`（不是 `true`）。
- [x] Given `minspect uninstall-autostart --yes` on Windows，When 命令跑完，Then `reg query HKCU\…\Run /v minspect-daemon` 返回"找不到值"；config `autostart` 写为 `false`。
- [x] Given `scripts/dev-switch.ps1 local` on Windows where autostart was previously enabled，When 脚本跑完，Then HKCU Run key 中 `minspect-daemon` 值存在（重新注册成功）。
- [x] All 166 CLI tests pass; `pnpm -r build` 0 type error; `npx biome check` on touched files 0 error。
- [x] `pnpm -r test` workspace-wide green (414 tests total, 166 in cli package including 13 new scheduled-task cases)。

# Plan

- [x] T1 写 change card
- [x] T2 写 `scheduled-task.ts` 新版：HKCU Run key + `escapeReg` + `buildCommand` + `__testing__` 导出
- [x] T3 写 `scheduled-task.test.ts` 13 个 case
- [x] T4 改 `init.ts` autostart block
- [x] T5 改 `status.ts:computeAutostartStatus` Windows 分支
- [x] T6 改 `doctor.ts:checkAutostart` Windows 分支
- [x] T7 改 `install-autostart.test.ts` Windows case
- [x] T8 改 `uninstall-autostart.test.ts` 默认 mock
- [x] T9 改 `init.test.ts` install-失败分支 + 默认 mock
- [x] T10 改 `scripts/dev-switch.ps1`
- [x] T11 跑 `pnpm -r test` / `pnpm -r build` / biome check
- [x] T12 端到端真机验证：reg add → status ✓ → uninstall → reg query 不存在 → reinstall → status ✓
- [x] T13 更新 `minispec/specs/cli.md`；归档 change card

# Risks and Rollback

- Risk: HKCU Run key value name 在某些第三方 app 清理工具扫描时被误删。
  - 缓解: 名称 `minspect-daemon` 足够独特不易冲突；如被清掉，用户重跑 `install-autostart` 即可恢复（属于次要运维问题）。
- Risk: 路径里若同时含 `\` 和 `"`（罕见但理论可能）会双重转义出错。
  - 缓解: `escapeReg` 测试覆盖两个字符分别 + 组合；`buildCommand` 测试也覆盖。
- Risk: `reg.exe` 写入到 HKCU 在容器化/CI 环境里被 GPO 锁。
  - 缓解: 跟之前一样——失败时 `init.ts` 写 `autostart: false`，doctor 报 warn，user 看得到。
- Rollback: 全部改动都在 Windows-specific 分支 + dev-switch 脚本 + 测试 mock；macOS / Linux 路径完全不动。把 `scheduled-task.ts` / `status.ts` / `doctor.ts` / `install-autostart.ts` 还原到 `/XML` 版本 + revert 测试 + revert dev-switch → 回到 v0.1.7 行为（已知坏的）。

# Notes

- **为什么放弃 Task Scheduler**：ONLOGON 触发器需要 admin 串起 session-attached token，schtasks 显式拒绝非 admin。HKCU Run key 任何交互用户都能写，Explorer 在 logon 时 launch，与 ONLOGON 等 UX，且不写 `C:\Windows\System32` 这种敏感位置。
- **为什么 backend 仍叫 `scheduled-task`**：纯历史命名；改名为 `hkcu-run` 会动 status/doctor 文本和 `--backend` 用户参数，收益小、风险大。注释里说明清楚就行。
- **`reg.exe` 路径转义规则**：路径里每个 `\` 必须写为 `\\`（避免 reg.exe 当 escape），每个内嵌 `"` 必须写为 `\"`（避免 reg.exe 当 value 边界）。`escapeReg()` 负责这步；测试覆盖。
- **`dev-switch.ps1` 备份 config**：用 `node -e "..."` 而不是 `jq`，不增加新依赖；读 JSON + 写回的逻辑 ~10 行 Node，跨平台一致。
- **不影响 macOS / Linux**：launchd / systemd 的 unit 文件生成走完全不同的路径（plist / .service 文本文件 + `launchctl bootstrap` / `systemctl --user enable --now`），没踩过 Windows 同样的坑。
- **回归测试**：13 个新单测覆盖 escape、build、plan、isInstalled 两条分支；doctor 6 个 + status 10 个现有测试都还过。
