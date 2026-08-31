---
id: 20260831-fix-autostart-console-window
status: closed
owner: claude
---

# Why

Windows 的 HKCU Run key 后端（卡 `20260627-fix-windows-autostart` 引入）把 Run 值存成裸 `"node.exe" "bin.cjs" serve --quiet`，Explorer 在登录时直接启动 node.exe——它是控制台子系统程序，**每次登录都会在桌面上弹出一个黑色控制台窗口**；窗口被关闭（用户手动关、或任何控制台 teardown）时 daemon 进程被一并杀掉。hook/init 路径的 `spawnServeDetached` 用 `detached + windowsHide: true`，无窗口、稳定存活——两路径行为不一致。

真机取证（2026-08-31，本机）：8/28 17:09 Run 键已注册且启用（StartupApproved `02`）；17:59:26 冷启动（Kernel-Boot 0x0）、17:59:43 登录（TerminalServices 21/22）；但当前 daemon pid 6896 的进程启动时间是 18:03:43、state.json `started_at` 18:03:46——即用户 4 分钟后手动 `minspect start` 的产物；事件日志无任何 node 崩溃记录。Run 键要么没产出进程、要么进程在几分钟内被外部终止，与"可见控制台窗口被关"最吻合。

次要问题：`escapeReg` 把 `\` 双写成 `\\` 存进注册表数据。当时的假设「reg.exe 把 `\` 当 escape」是错的——reg.exe 不处理 `\` 转义，`\\` 被原样存入（现网 Run 值即 `D:\\Program Files\\nodejs\\node.exe`）；实测命令能跑通只是因为 Win32 路径归一化容忍重复分隔符。数据不干净，且路径若以 `\` 结尾会把收尾引号转义掉、彻底破坏解析。

# Approach

- Considered:
  - Option A: 换回 Task Scheduler（`/IT` 隐藏窗口）。trade-off: ONLOGON 触发器需要 admin，6月已实证被 `schtasks` 拒绝，不走回头路。
  - Option B: Run 键改存 `wscript.exe "<state_dir>\minspect-daemon.vbs"`，VBS 用 `WScript.Shell.Run "<node> <bin> serve --quiet", 0, False` 隐藏启动。trade-off: 多一个生成的小文件；wscript 是 Windows 自带组件，登录会话 PATH 必含 System32。**Chosen**。
  - Option C: `conhost.exe --headless node ...`。trade-off: `--headless` 是 conhost 未文档化参数，跨 Windows 版本行为无保证。
- Chosen: Option B + 路径不再做 `\` 双写（原样写入 VBS；VBS 字符串内 `"` 按 VBS 规则双写）。`wscript.exe` 用裸名——Explorer 的登录环境必能从 System32 解析，同时避免 SystemRoot 大小写 / env 差异造成的不可测性。

# Scope

- In:
  - `packages/cli/src/commands/autostart/scheduled-task.ts`：重写——`daemonVbsPath(ctx)` / `buildVbsBody(ctx)`（UTF-16 LE + BOM 写盘）/ `buildRunValue(ctx)`（`wscript.exe "<vbs>"`）；`executeScheduledTask(plan, ctx)` 先写 VBS 再 `reg add`；`removeScheduledTask(plan, ctx)` 增加 VBS 清理；删除 `escapeReg`；更新 `__testing__` 导出。
  - `packages/cli/src/commands/install-autostart.ts:277`：`removeScheduledTask(plan)` → `removeScheduledTask(plan, ctx)`。
  - `packages/cli/src/commands/autostart/scheduled-task.test.ts`：重写 escape/build 断言（verbatim 路径、BOM、Run 参数 0/False、remove 清理）。
  - `packages/cli/src/commands/install-autostart.test.ts`：Windows case 的 `/d` 断言改为 VBS 形态 + 新增 VBS 文件存在断言。
  - `minispec/specs/cli.md`（close 时）：Windows autostart 描述 + 纠正"reg.exe 把 `\` 当 escape"的错误结论。
- Out:
  - macOS / Linux backends（launchd / systemd / xdg 本身无窗口问题）。
  - status / doctor 探针（只探 Run 值 presence，值名不变，无需动）。
  - `scripts/dev-switch.ps1`（经 `minspect install-autostart` 重注册，自动获得新形态）。
  - 不引新依赖；不改 `AutostartPlan` 公共接口（VBS 路径由 ctx 确定性推导）。

# Acceptance

- [x] Given `runInstallAutostart`（win32，mocked reg，注入 `stateRoot`/`nodePath`/`minspectBinPath`），When 执行，Then HKCU Run 值 `minspect-daemon` = `wscript.exe "<stateRoot>/minspect-daemon.vbs"`（无 `\\` 双写），且 `<stateRoot>/minspect-daemon.vbs` 存在、以 UTF-16LE BOM（FF FE）开头、解码后内容含 verbatim node/bin 路径 + `serve --quiet` + `, 0, False`。（install-autostart.test.ts Windows case + scheduled-task.test.ts）
- [x] Given `planScheduledTask(ctx)`，When 检查计划，Then `enable` = `reg add HKCU\...\Run /v minspect-daemon /t REG_SZ /d <runValue> /f`，`disable` = `reg delete ... /f`，`isInstalled` 探针语义不变，`unitPath` 字符串不变。（scheduled-task.test.ts 6 个 plan case）
- [x] Given `removeScheduledTask(plan, ctx)` 且 VBS 文件存在，When 执行，Then `reg delete` 按计划被调用且 VBS 文件被删除；文件不存在时静默不抛。（scheduled-task.test.ts removeScheduledTask 2 个 case）
- [x] Given node/bin 路径含空格（Windows 风格反斜杠），When 生成 VBS body，Then 路径反斜杠原样保留（无 `\\` 双写），整体作为单个 VBS 字符串字面量（内嵌 `"` 按 VBS 规则双写）。（buildVbsBody 3 个 case）
- [x] `pnpm -r test` 全绿（CLI 包 176 tests，workspace exit 0）；`pnpm lint` 见 Notes（仓库级 lint 因本机 `core.autocrlf=true` 的预存 CRLF 状态失败，与本次改动无关；touched files 经 `biome check --write` 后 0 error）；`pnpm -r build` 0 type error。
- [x] 真机端到端：仓库构建以 test seams（node/bin 指向全局 npm 安装）重跑 `install-autostart` → `reg query` 显示 `wscript.exe "C:\Users\admin\AppData\Local\minspect\minspect-daemon.vbs"` 新形态；`minspect stop` 后经 `wscript.exe <vbs>` 拉起 daemon（新 pid 54172，`minspect status` ✓，无可见窗口、无报错）。迁移后本机注册即为修复形态。

# Plan

- [x] T1 写 change card（本文件）
- [x] T2 重写 `scheduled-task.ts`：VBS 包装 + verbatim 路径 + 写/清文件
- [x] T3 重写 `scheduled-task.test.ts`：escape/build/plan/execute/remove 全覆盖
- [x] T4 `install-autostart.ts` 调用点签名 + `install-autostart.test.ts` Windows case 更新
- [x] T5 `pnpm -r test` / `pnpm lint` / `pnpm -r build`
- [x] T6 真机迁移 + 端到端验证
- [x] T7 close：更新 `minispec/specs/cli.md`，卡片归档

# Risks and Rollback

- Risk: 旧版用非默认 `stateRoot` 装过 → uninstall 只删当前推导路径的 VBS，旧文件残留（孤立小文件，无害）。
  - 缓解: `rmSync` force + 静默；daemon 启动只依赖当前 Run 值指向的 VBS。
- Risk: 企业环境 GPO 禁用 wscript（罕见）→ 登录后 daemon 不启动，但 Run 值存在、status/doctor 的 presence 探针仍 ✓。
  - 缓解: doctor 的 daemon 检查与 `minspect status` 会暴露 daemon 不在；fallback 是手动 `minspect serve` / `start`。
- Risk: 非 ASCII 安装路径下 VBS 被按系统 codepage 误读。
  - 缓解: VBS 以 UTF-16 LE + BOM 写盘，WSH 按 BOM 判编码，与系统 codepage 无关。
- Rollback: 改动全部限于 Windows backend + 两个测试文件；revert 即回到 v0.1.8 行为（已知缺陷）。已迁移的机器重跑旧版 `install-autostart`（或 `reg add` 旧命令）即回到旧形态。

# Notes

- 真机取证原始数据：Run 键注册时间以 `<state_dir>/config.json` mtime 17:09:06 界定（`install-autostart` 写 autostart:true 的时刻）；登录证据 `Microsoft-Windows-TerminalServices-LocalSessionManager/Operational` 事件 21/22 = 2026-08-28 17:59:43；启动证据 `Microsoft-Windows-Kernel-Boot` 事件 27（0x0 冷启动 8/28 17:59:26、0x2 休眠恢复 8/31 10:08——后者不触发 Run 键也不杀进程）；pid 6896 `StartTime=2026-08-28 18:03:43`（PowerShell Get-Process 实测）。
- `state.json` 的 `spawned_by` 无法区分 Run 键与手动启动：Run 键路径不设 `MINSPECT_SPAWNED_BY`，`resolveSpawnedBy()` 默认 `'user'`（serve.ts:99-103）。
- 0.1.8 现网 Run 值形态（迁移前）：`"D:\\Program Files\\nodejs\\node.exe" "C:\\Users\\admin\\AppData\\Roaming\\npm\\node_modules\\@ivenlau\\minspect\\bin.cjs" serve --quiet`。
- 已装 0.1.8 的机器需重跑 `minspect install-autostart`（或 `init`）迁移；Run 值形态变了，但值名与 presence 探针不变，status/doctor 无感知。
- 真机迁移记录（2026-08-31）：仓库构建 + `runInstallAutostart` seams（nodePath/minspectBinPath 指向全局 npm 0.1.8 安装）→ Run 值已换 VBS 形态；`minspect stop` 后 `wscript.exe <vbs>` 拉起 daemon（pid 54172）成功、无可见窗口。未在本机做 uninstall 端到端演练（避免对在用注册反复写删），清理路径由单测覆盖。
- **顺手发现的独立缺陷（未修，建议单开卡片）**：`pnpm -r test` 在 Windows 上会改动真实用户文件——测试用 `process.env.HOME` 重定向家目录，但 Windows 的 `os.homedir()` 读 `USERPROFILE` 不吃 `HOME`，导致 uninstall/install 类测试打穿到真实 `~/.claude/settings.json`（`__minspect_managed__` 被清）与 `~/.config/opencode/plugins/minspect.ts`（被删）。本次已用全局 `minspect install --agent claude-code / opencode --scope user` 恢复。修复方向：Windows 下同步重定向 `USERPROFILE`（或在命令层注入 homedir 依赖）。
- 本机 `pnpm lint` 仓库级失败的预存原因：`core.autocrlf=true` 使整个工作区为 CRLF，biome 全仓报 220 个行尾错误（含未触碰文件，如 `serve.ts`）。touched files 已 `biome check --write` 后 0 error。
- **发布插曲（v0.1.9 tag 重发，0a2ce44）**：首发 CI 的 bundle integrity tests 在 ubuntu 上失败——`daemonVbsPath` 用 `path.join` 拼接，宿主为 Linux 时注册表值出现混合分隔符（`...\minspect/minspect-daemon.vbs`）。该字符串会被 Windows 在登录时消费，必须恒为 `\` 分隔符。修复：`daemonVbsPath` 显式 `\` 拼接（平台无关），文件系统读写另走 host-path 变体（真实 Windows 安装上两者逐字节一致）。在 WSL Ubuntu-24.04（node 20）以 build + 全量 cli 套件复现并验证修复（25 files / 177 tests 全绿）。npm 上 0.1.9 未曾发布成功，故将 tag `v0.1.9` 强移至修复提交重发，CI 发布成功、npm 上线 0.1.9。
- VBS `Run` 第二参 `0` = 隐藏窗口，第三参 `False` = 不等待退出（与 `spawnServeDetached` 的 detached 语义对齐，daemon 独立于 wscript 进程存活）。
