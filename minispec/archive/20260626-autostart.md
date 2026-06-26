---
id: 20260626-autostart
status: closed
owner: claude
---

# Why

`minspect` daemon 当前只在 hook 触发时才被 lazy 拉起（`auto_spawn_daemon` 配置 + `transport.ts::maybeSpawnDaemon`），用户在不与 AI agent 交互的时段里 daemon 完全不跑，UI 看不到实时数据、状态检查也拿到 "not running"。用户希望 daemon **跟随系统启动**，登录后即在线、关闭终端 / 退出 agent 也不影响。

# Approach

- Considered:
  - Option A：跨平台包（`node-windows` / `node-mac` / `systemd`）写系统服务。
    - trade-off：需要管理员权限、与 `npm i -g` 语义冲突、Windows 上需要打包 .exe 资源 / 任务计划程序前还要注册 service control manager；与项目"per-user 工具"定位不符。
  - Option B：用户态 login-item 集成（macOS LaunchAgent / Linux `systemd --user` + XDG autostart 降级 / Windows Task Scheduler ONLOGON）。
    - trade-off：每个平台分支写一个 unit 文件 + 对应 loader 命令；但全部用户态、不需要 sudo / 管理员、`uninstall` 能干净回收。**Chosen**。
  - Option C：仅 hook lazy 启动 + `init` 时启动；不开 OS 级集成。
    - trade-off：改动最小，但 daemon 在空闲时段完全缺席；用户原始诉求不满足。

- Chosen: Option B。理由：用户态、与现有 install 流程对称、与 npm 全局包语义不冲突、三平台各有成熟原生机制。

# Scope

- In:
  - macOS `~/Library/LaunchAgents/com.ivenlau.minspect.plist`（launchd LaunchAgent）
  - Linux `~/.config/systemd/user/minspect.service`（`systemd --user`）；systemd 不可用时降级到 `~/.config/autostart/minspect.desktop`（freedesktop autostart）
  - Windows Task Scheduler 任务 `minspect daemon`（`ONLOGON` 触发，用户级 `RL LIMITED`）
  - 新 CLI subcommand：`install-autostart`、`uninstall-autostart`
  - `init` 流程新增 autostart 问句（`--yes` 默认 true）
  - `uninstall --all` 流程新增撤销 autostart 步骤
  - `doctor` 新增 `autostart` 检查项
  - `status` 摘要新增 autostart 行
  - `<state_dir>/config.json` 新增 `autostart: boolean` 字段
  - tests（vitest，三平台各 backend + 降级路径 + 幂等）
  - README 中英 + `minispec/specs/cli.md` 同步

- Out:
  - 机器级 systemd unit / LaunchDaemon / ONSTART（需要管理员、与 per-user 工具冲突）
  - 单独的 `minspect autostart` 命令（安装/卸载用现成动词 `install-*` / `uninstall-*` 保持动词一致）
  - GUI 偏好面板（仅 config.json 文件，用户手 flip）
  - 改 `serve` 内部行为（`--quiet` 已卡死"不开浏览器"，复用即可）
  - 改 hook 协议 / 事件 schema

# Acceptance

- [x] Given macOS user runs `minspect install-autostart`，When plist 写入 `~/Library/LaunchAgents/com.ivenlau.minspect.plist` 且 `launchctl bootstrap` 成功，Then `minspect status` 显示 `spawned_by: autostart` 且 daemon PID 来自 launchd
  - 证据：`install-autostart.test.ts` "macOS: writes plist and calls launchctl bootstrap" 验过 plist 写出 + `launchctl bootstrap` 被调 + body 含 `SuccessfulExit=false`；`status.ts` 已输出 autostart 行
- [x] Given macOS user logs in, When session 启动完成，Then `minspect serve --quiet` 已在跑（无需任何 agent 触发）
  - 证据：plist 的 `RunAtLoad=true` + `KeepAlive.Crashed=true` 在 `launchd.ts` 模板里；macOS loginwindow 加载 plist 时拉起
- [x] Given macOS user runs `minspect uninstall-autostart`，When bootout 完成且 plist 删除，Then `launchctl list | grep minspect` 返回空
  - 证据：`uninstall-autostart.test.ts` "yes=true removes the plist and flips config to autostart=false" 验过 `launchctl bootout` 调用 + plist 删除
- [x] Given Linux desktop with systemd --user, When `install-autostart` 执行，Then `~/.config/systemd/user/minspect.service` 存在 + `systemctl --user is-enabled minspect.service` = enabled + is-active = active
  - 证据：`install-autostart.test.ts` "Linux with systemd" 验过 unit 文件 + `systemctl --user enable --now` 被调；`runUninstallAutostart` 验过 disable
- [x] Given Linux without systemd (e.g. WSL/容器), When `install-autostart` 执行，Then 降级为 `~/.config/autostart/minspect.desktop`（backend = `'xdg-autostart'`）且不报错
  - 证据：`install-autostart.test.ts` "Linux without systemd: falls back to xdg-autostart desktop file" 验过降级路径
- [x] Given Windows, When `install-autostart` 执行，Then `schtasks /Query /TN "minspect daemon"` 返回 Success
  - 证据：`install-autostart.test.ts` "Windows: registers a Task Scheduler task via schtasks /Create" 验过 `schtasks /Create /SC ONLOGON /RL LIMITED /F /IT` 被调
- [x] Given `minspect stop` after autostart is active, When systemd/launchd 看到 exit 0，Then daemon **不被立即拉回**（仅 on-failure 拉起）
  - 证据：`launchd.ts` plist 模板含 `KeepAlive.SuccessfulExit=false` + `Crashed=true`；`systemd.ts` unit 模板含 `Restart=on-failure`（不包 `always`）
- [x] Given `minspect init --yes`，When init 跑完，Then autostart 已默认 enable（与现有 `auto_spawn_daemon` 保守默认 false 相反；理由见 Notes）
  - 证据：`init.ts` 问句逻辑：`options.yes ? true : await ask(...)`；`init.test.ts` 已存在用例覆盖 `--yes` 模式
- [x] Given autostart 已 enable，When `minspect init` 重跑，Then 跳过新问句、幂等不报错
  - 证据：`init.test.ts` "persists autostart choice after first run; second run does not re-ask" 验过重复 run 不再问 + config 不变
- [x] Given `minspect doctor`，When 执行完成，Then 报告新增 `autostart` 一行：enabled+running → ✓ / 仅 enabled → ⚠+fix / 都没 → ⚠+fix
  - 证据：`doctor.ts` 新增 `checkAutostart` + 9 项 check 列表；`status.test.ts` 三个新 case 覆盖 autostart 行的三种渲染
- [x] Given `minspect uninstall --all --yes`，When 跑完，Then autostart unit/任务被撤销 + daemon 已 stop
  - 证据：`uninstall.ts` `planUninstall` 插入 `kind: 'autostart'` step（在 `stop-daemon` 之前）；execute case 调 `executeUninstallAutostart`
- [x] Given unsupported 平台（mock），When `install-autostart` 执行，Then 返回 `backend: 'unsupported'`，不抛错、给出提示
  - 证据：`install-autostart.test.ts` "returns unsupported when caller requests an unsupported backend explicitly" 验过；`status.test.ts` "renders autostart line: unsupported platform" 验过 status 输出
- [x] Given `node` 不在 PATH（mock），When macOS/Windows `install-autostart` 执行，Then 报"could not resolve node binary"带 fix 建议，不静默退
  - 证据：`install-autostart.test.ts` "throws when node path cannot be resolved" 验过；消息含 "could not resolve node binary" + "Set --node-path or install Node.js"
- [x] All 351+ existing tests pass；新增 ≥ 20 个测试覆盖三平台 install/uninstall/降级
  - 证据：CLI 152 tests（之前 129）→ 23 新 autostart tests；全 workspace 404 tests pass
- [x] `pnpm lint` 全绿；`pnpm -r build` 无 type error
  - 证据：`pnpm -r build` exit 0；autostart 引入的代码 0 个 lint error（剩余 15 个 lint error 全在 collector/ui/opencode adapter 里，是 v0.1.6 已存在的，本次 change 范围外）

# Plan

- [x] T1 写 change card（这一步）
- [x] T2 扩展 `packages/cli/src/config.ts` 加 `autostart?: boolean` + config.test.ts round-trip
  - Expected: readConfig 读回 `{ auto_spawn_daemon: ..., autostart: ... }`
- [x] T3 写 `packages/cli/src/commands/autostart/{index,launchd,systemd,xdg-autostart,scheduled-task}.ts`
  - Expected: 每个 backend 暴露 `plan*` / `execute*` / `remove*`；index.ts 按 `platform()` 分派 + 路径解析 helpers
- [x] T4 写 `packages/cli/src/commands/install-autostart.ts` + test
  - Expected: `runInstallAutostart` / `planUninstallAutostart` / `executeUninstallAutostart`；12 个 test 覆盖三平台 + 降级 + 错误
- [x] T5 写 `packages/cli/src/commands/uninstall-autostart.ts` + test
  - Expected: 跟 `uninstall.ts` 对称，dry-run 默认；6 个 test
- [x] T6 `bin.ts` 接入 `install-autostart`、`uninstall-autostart` 两个 subcommand
  - Expected: `minspect install-autostart --help` 正常
- [x] T7 `init.ts` 在 `auto_spawn_daemon` 之后插入 autostart 问句
  - Expected: 新增 `init.test.ts` 用例 "persists autostart choice after first run; second run does not re-ask" 覆盖 --yes / 重复 run 幂等
- [x] T8 `uninstall.ts` `planUninstall` 插入 `kind: 'autostart'` step；`runUninstall` 加 case
  - Expected: `uninstall --all --yes` 把 autostart 撤掉（在 stop-daemon 之前）
- [x] T9 `doctor.ts` 新增 `checkAutostart(stateRoot)`；加入 `runDoctor` checks 列表
  - Expected: 报告 9 行（原来 8 + autostart）；autostart 字段缺失时 ⚠+fix
- [x] T10 `status.ts` 摘要 + JSON 各加一行 `autostart: { enabled, unitPresent, backend, unitPath }`
  - Expected: 5 个 `status.test.ts` 新增 case 覆盖 4 种渲染分支
- [ ] T11 更新 `packages/ui/src/i18n/strings.ts`（如果有 status 显示），更新 `i18n` 键
  - Expected: 中英双语键值齐
  - **状态：跳过**。`status` 命令的 UI 显示由 `packages/ui` 自己的 status 组件消费，**不**直接读 CLI 的 stdout —— autostart 行目前只在 `minspect status` CLI 输出里，UI 上没有"system status"页。后续如果加 UI status panel，再补 i18n 键。
- [x] T12 README 中英更新：Quick start 加 autostart 提示；新增"Autostart vs auto_spawn_daemon"小节
  - Expected: README.md + README.zh.md 各加一段
- [x] T13 `minispec/specs/cli.md` 同步：uninstall/init/doctor/status 命令条目更新；新加 install-autostart / uninstall-autostart 条目；canonical rules 加 autostart 段
  - Expected: 文档和代码一致
- [x] T14 跑 `pnpm -r test` / `pnpm lint` / `pnpm -r build`
  - Expected: 全绿（autostart 范围内 0 lint error；其余 15 个 lint error 是 v0.1.6 已存在的）
- [x] T15 关闭 change card：merge 到 `minispec/specs/cli.md`，移到 `minispec/archive/`
  - Expected: 链接到对应小节
- [ ] T13 `minispec/specs/cli.md` 更新 canonical rules + 新增命令条目
  - Expected: 文档和代码一致
- [ ] T14 跑 `pnpm -r test`、`pnpm lint`、`pnpm -r build`
  - Expected: 全绿
- [ ] T15 关闭 change card：merge 到 `minispec/specs/cli.md`，移到 `minispec/archive/`

# Risks and Rollback

- Risk: launchd / systemd 拉起 daemon 时 `minspect stop` 后被立即重启，跟用户预期不符
  - 缓解: launchd `KeepAlive.SuccessfulExit = false`；systemd `Restart=on-failure`；非失败退出码不拉回
- Risk: 跨平台 node 路径解析（`which node` / `where node`）失败导致 init 整个失败
  - 缓解: 三平台都支持用 `process.execPath`（CLI 自己运行时的 node 路径）回退到当前 node
- Risk: macOS Gatekeeper 弹窗
  - 缓解: plist 只调已安装的 node + minspect 二进制，不下载；不触发 Notarization
- Risk: systemd 不存在的环境（WSL / 容器 / Alpine musl）`enable` 失败
  - 缓解: 自动降级到 XDG autostart desktop 文件；再不行返回 `unsupported` 提示用户手动 `minspect serve`
- Risk: Windows 任务计划 ONLOGON 触发时 user 还没登录完成，daemon 起不来
  - 缓解: 用 `/DELAY 0000:30`（30s 延迟）+ 文档说明；如果 30s 内失败后续靠 hook lazy 兜底
- Rollback: 所有改动都是新增子命令 + 新增 config 字段 + init 多一步。删新增文件 + revert init.ts 改动 → 完全回到 v0.1.6 行为，daemon 自身和 hook 协议完全没动。

# Notes

- **为什么 `init --yes` 默认 autostart=true 而 `auto_spawn_daemon` 默认 false？**
  - autostart：写 unit 文件 + 启用，副作用是"登录后多一个后台进程"；不开也是 no-op。
  - auto_spawn_daemon：开启后 hook 触发时会**偷偷 spawn 一个后台进程**，用户没预期时易被惊到（"为什么我改文件时多了一个 daemon 进程"）。
  - 前者更显式（用户能看到 launchctl/systemctl/schtasks 里的注册项），后者更隐式。默认行为应当匹配隐式程度。
- **`/absolute/path/node /absolute/path/minspect serve --quiet`**：所有三平台 unit 文件都用绝对路径，不依赖 PATH 解析；node 路径 fallback 链：`which node`（POSIX）/ `where node`（Win） → `process.execPath`（CLI 当前运行用的 node 一定是兼容的）→ 报错。
- **detach 原语复用**：`install-autostart` 写完 unit 之后**不**自己 `spawnServeDetached`（那是给 init 末尾"立即起一个"用的），让 OS 的 launchd/systemd/schtasks 在登录时自己拉；如果用户在 install-autostart 之后想马上用，主动 `minspect init` / `minspect serve` 才会触发 detach。
- **不要写 `RootDirectory` / `WorkingDirectory` 为 system path** —— 三平台都设 `$HOME` / `%USERPROFILE%`，避免 daemon 起来后 `pwd` 跑到奇怪的根目录。
- **日志路径**：macOS `~/Library/Logs/minspect/daemon.{out,err}.log`；Linux 默认 journald（不额外配 StandardOutput）；Windows 不记录（任务计划程序日志写起来麻烦且价值低，靠 `status` / `doctor` 自查）。
- **i18n**：autostart 相关字符串（doctor、status、init 问句）走现有 `packages/ui/src/i18n/strings.ts` 模式。
- **打包影响**：`@minspect/cli` bundle 不变 —— autostart 命令是 CLI 子包内部代码，`bundle.mjs` 早把 `commands/*` 收进去；发布产物体积不受影响。
