# CLI

`@minspect/cli` — hook 入口 + 安装命令。绝对路径二进制挂到 agent 的 hook 配置里，每次 hook 触发由 OS 起独立进程。

## Commands

- `minspect capture [--event <name>]`：从 stdin 读 Claude Code hook payload，更新会话状态，调 adapter 产出 `Event`，POST 到 collector（失败落盘队列）。总是 `exit 0`，绝不阻塞 agent。
- `minspect capture-opencode`：plugin 入口。从 stdin 读 OpenCode hook envelope（`{hookName, payload, timestamp}`），过 `parseOpenCodeEnvelope` + 持久化 `<state_dir>/sessions/opencode-<session_id>.json` + POST（失败落队列）。同样绝不阻塞。
- `minspect install --agent <claude-code|opencode> [--scope user|project]`：
  - `claude-code`：往 `settings.json` 注入 hook 块，幂等 + 备份。
  - `opencode`：写 `~/.config/opencode/plugins/minspect.ts`（user）或 `.opencode/plugins/minspect.ts`（project）—— plugin 文件订阅 `event` + `tool.execute.before` + `tool.execute.after`，每个回调 spawn + unref `minspect capture-opencode` 子进程。BEGIN/END 标记块 + `.bak.<ts>` 备份；对非 minspect 管理的现存 plugin 文件也会先备份再覆盖。
- `minspect link-commit`：典型从 `.git/hooks/post-commit` 调用。读取 HEAD 与父 commit 间的改动文件列表（首 commit 走 `git show --name-only --format= HEAD` 兜底；merge commit parents>2 跳过），POST 给 collector `/commit-links`。非 repo / collector down 静默退出 0。
- `minspect serve [--port <p>] [--no-open]`：前台模式启动 collector + 自动打开浏览器。**默认端口 21477**（卡 40）；占用则 fallback 21478…21486，stdout 打印原因。`--port N` 明指时不 fallback，占用即失败；`--port 0` 让 OS 随机（测试隔离用）。检测 state 发现已有健康 daemon 则复用；但若 daemon 启动时间早于 `packages/collector/dist/index.js` 的 mtime（代码重建过），判定 stale，kill + restart。Ctrl-C / SIGTERM 清理 state 并退出。
- `minspect stop`：读 state → kill PID + 清 state。
- `minspect uninstall [--agent <a>] [--all] [--purge] [--yes]`（卡 41）：对称 install。默认 dry-run 只打印"will remove"；`--yes` 才写。`--agent claude-code` 只撤 settings.json 里 `__minspect_managed__: true` 的 hook entry；`--agent opencode` 若文件整份是我们的就删文件，否则只 strip BEGIN/END 块保留用户代码；`--all` 额外撤 cwd git 仓 post-commit + 停 daemon；`--purge` 再删 `<state_dir>/history.sqlite*` + `sessions/` + `queue/`。全部步骤每项单独备份 `.bak.<ts>`。
- `minspect doctor [--json]`（卡 42）：诊断输出，8 项检查：`node`（≥20）、`state-dir`（可写）、`daemon`（state.json 正确且 /health 200）、`hook-claude-code`、`hook-opencode`、`hook-post-commit`（非 git 仓 skip）、`db`（history.sqlite 存在）、`events`（/api/sessions 最近 5 min 内有活动）。每项 ✓/⚠/✗ + fix 建议；`--json` 机器可读；有 fail 退出码 1。
- `minspect status [--json]`（卡 45）：只读诊断输出，daemon 状态 / 端口 / pid / `spawned_by` / queue / 最近 event age / hook 安装状态。**无参 `minspect` 默认调用 status**（commander `isDefault: true`），帮助页仍由 `--help` 触发。
- `minspect init [--yes]`（卡 44 + 卡 48）：聚合命令。流程：跑 doctor → 检测 agent（`~/.claude/settings.json` / `~/.config/opencode/` / `~/.codex/sessions/`） → 逐项交互问是否装 Claude Code hook / OpenCode 插件 / Codex 30d import / cwd git 仓 post-commit hook → 首次问 `auto_spawn_daemon`（写入 `<state_dir>/config.json`） → **detach-spawn 后台 daemon**（`spawnServeDetached({spawnedBy: 'init'})`） → `waitForDaemonReady` 最多 5s 轮询 `/health` → 打开浏览器 → init 本身 exit 0。init 完成后可关闭终端，daemon 不受影响。若 daemon 已在跑，`findRunningDaemon` 命中直接打印 `already running on :PORT` + 开浏览器，不重复 spawn。spawn 超时走"请手动跑 `minspect serve` 看错误"的降级路径，不崩溃。`--yes` 非交互，保守默认（装检测到的 agent hook、post-commit if git、不开 auto_spawn、不导入 Codex 避免长耗时）。已装 hook 自动 skip；重复 init 幂等。
- `minspect revert --turn <id> | --edit <id> [--yes] [--force]`：把文件恢复到 turn/edit 之前的状态。默认 dry-run；`--yes` 才写盘。drift 检测（磁盘当前文件 sha256 ≠ expected after_hash）默认拒绝，`--force` 覆盖。Codex 来源 session **硬拒绝**（hunk 窗口级 before/after 不足以安全 revert）。AI 新建的文件（before_hash=NULL）revert = 删除。
- `minspect import-codex --session <path|uuid> | --latest [--dir <override>]`：事后导入 Codex rollout-*.jsonl。
- `minspect vacuum [--fix] [--clear-poison]`：扫描数据卫生问题。默认 dry-run 报告 orphan blame rows / orphan blobs / 隔离事件数。`--fix` 删孤儿 DB 行；`--clear-poison` 删 `queue/.poison/*.json`。
- `minspect link-commit`：post-commit hook 入口。读 HEAD + parent 列表 + `git diff --name-only`，POST 到 collector `/commit-links`。merge commit（parent>1）直接跳过；首次 commit 用 `git show --name-only HEAD` 兜底。非 git repo / collector 未运行 → 静默跳过，绝不阻塞 git。

## Public surface（可测试）

- `runCapture({stateRoot?, payload?})`：便于单测注入。
- `runCaptureOpenCode({stateRoot?, rawEnvelope?})`：同上，针对 OpenCode envelope。
- `runInstall({agent, settingsPath?, aiHistoryBin?, scope?})`：返回 `{path, backup, wrote}`。
- `runInstallOpenCode({pluginPath?, aiHistoryBin?, scope?})`：返回 `{path, backup, wrote}`。
- `readOpenCodeState(sessionId, root?)` / `writeOpenCodeState(sessionId, state, root?)`：OpenCode session 状态文件。
- `runLinkCommit({cwd?, stateRoot?})`：post-commit 入口；无 repo / 无 collector 静默 return。
- `installPostCommitHook({repoRoot, aiHistoryBin})`：写入 `.git/hooks/post-commit`，BEGIN/END 标记块，幂等、备份、Windows 路径转 forward slash。
- `spawnServeDetached({spawnedBy})` / `waitForDaemonReady({stateRoot?, timeoutMs?})` / `findRunningDaemon(stateRoot?)` / `openBrowser(url)`（卡 48）：detach-spawn daemon 的共享原语。`minspect init` 与 hook auto-spawn（`transport.ts::maybeSpawnDaemon`）共用这套，保证 detach 语义一处定义。
- `readSessionState(sessionId, root?)` / `writeSessionState(state, root?)`：每会话状态文件。
- `enqueueEvent` / `listQueued` / `readQueued` / `removeQueued`：磁盘队列原语。
- `sendEvent(event, root?)`：带队列 drain 的发送。
- `runLinkCommit({cwd?, stateRoot?})`：post-commit hook 入口。
- `installPostCommitHook({repoRoot, aiHistoryBin})`：写 `.git/hooks/post-commit`，`# >>> minspect managed >>>` 包裹块，幂等 + 备份 + chmod 755（Windows 无 chmod 走 git-for-windows 友好的 forward-slash 路径）。

## Canonical rules

- **Hook 绝不阻塞 agent**：任何异常 → 写 stderr → `process.exit(0)`。
- **每会话一个状态文件**：`<state_dir>/sessions/<session_id>.json`，跨进程保存 `turn_idx` / `current_turn_id` / `tool_call_idx` / `pretool_before`。
- **Pre/Post 配对**：PreToolUse 记录 before；PostToolUse 读 after + 组装 `file_edits` + 清空该 file_path 的 before。非 Edit/Write/MultiEdit 工具不组装 `file_edits`。
- **Stop 时调用 transcript reasoning 提取**（`transcript_path` 给就提取，没给就空）。
- **CLI 自持 ID**：`turn_id` / `tool_call_id` 都由 CLI `randomUUID()`；adapter 只 shape 不生成。
- **POST 超时 500ms**；失败落盘队列 `<state_dir>/queue/<ts>-<uuid>.json`；下次 capture 先 drain 再发本次。
- **Install 幂等**：hook 对象打 `__minspect_managed__: true` 标记；重跑时 strip 自己的 block 再重插。保留用户 hook。malformed settings → 抛错不覆盖。
- **Install 备份**：写前先 `copyFileSync` 到 `.bak.<ISO-timestamp>`。
- **bin 入口**：`packages/cli/dist/bin.js`（shebang + commander dispatch）。
- **Windows hook**：命令里 quote 完整绝对路径；不依赖 PATH；post-commit shell 脚本里的路径转 forward slash 兼容 git-bash。
- **post-commit 标记块**：`# >>> minspect managed >>>` ... `# <<< minspect managed <<<` 包裹；install 时 strip + 重插，保证幂等；用户自有 hook 内容保留。
- **link-commit 静默失败**：没 repo、merge commit、collector 离线、fetch 异常——一律 no-op 不阻塞 git。
- **init 起 daemon 走 detach-spawn**（卡 48）：`minspect init` 不在前台 hold daemon；用 `spawn(node, bin, serve, --quiet, {detached, stdio:ignore, windowsHide}).unref()` 起后台进程 + 轮询 `/health` 确认 ready，init 自身退出。关执行 init 的终端不会杀 daemon。前台 `minspect serve` 本身仍是前台阻塞，行为不变。
- **`serve --quiet` 永不开浏览器**（卡 50）：包括 fresh-start 和 reuse 两条路径。detach-spawn 的后台进程一律只是监听，不触发 UI 弹窗；想开浏览器的调用方（init 末尾、用户手动 `minspect serve`）自己走 `openBrowser`。
- **`maybeSpawnDaemon` 5s 冷却窗口**（卡 50）：`sendEvent` 同进程内一次 daemon 起动期最多 spawn 一次 `serve --quiet`，防 Codex import 这种突发 event 流的 spawn storm。冷却到期（daemon 还是没起来）允许再 spawn 重试。

## Packaging（卡 46）

- 发布形态：`minspect`（非 scoped npm 包）。`packages/cli/scripts/bundle.mjs`
  把 workspace（core / collector / adapters / ui）esbuild 进 `dist-bundle/bin.cjs`。
- native 依赖（better-sqlite3, tree-sitter*）保持 external，`dist-bundle/package.json`
  把它们列在 dependencies 里，`npm i` 时走 prebuild-install 拿预编译二进制。
- UI 静态资源复制到 `dist-bundle/ui/`；bundle 通过 `process.env.MINSPECT_UI_DIR`
  告诉 `@minspect/ui::getAppHtml / getAppAssetsDir` 去哪里找（banner 注入）。
- `import.meta.url` 在 CJS bundle 里通过 `define: { 'import.meta.url': '__importMetaUrl' }`
  + banner 中 `const __importMetaUrl = pathToFileURL(__filename).toString()` 实现。
- 产物结构：`dist-bundle/{bin.cjs, ui/, package.json, README.md}`。
- `packages/cli/src/bundle.test.ts` 运行 bundle 脚本并验证 layout + shebang +
  package.json 字段 + 工作区代码内联（零 `require('@minspect/*')`）+ 大小 < 10 MB。
- 发布流程：`pnpm -r build && pnpm -C packages/cli bundle && cd packages/cli/dist-bundle && pnpm publish`（手工触发；版本同 workspace）。
- **One-liner 脚本（卡 47 + 卡 49）**：`scripts/install.sh`（POSIX sh, macOS/Linux）+
  `scripts/install.ps1`（PowerShell）。都是薄包装：验证 Node ≥ 20 → `npm install -g @ivenlau/minspect[@version] --loglevel=error`
  → 打印 `minspect init` 提示。参数 `--version X` / `--skip-init` / `--verbose`
  （PS: `-Version` / `-SkipInit` / `-Verbose`）。默认 `--loglevel=error` 隐藏
  transitive peerOptional / deprecated warn（tree-sitter、prebuild-install 一类），
  `--verbose` 切 `--loglevel=notice` 给排障留后门。不编辑 shell rc；依赖 `npm -g`
  的全局 bin 在 PATH 里（典型 Node 安装默认就是）。二进制 release（pkg/bun 单 exe）
  留给后续卡。

## Changes

### 50-fix-multi-browser-open (closed 2026-04-29)

**Why**
用户开 `minspect init` + 同意 "Import 30d Codex sessions" + 开启
`auto_spawn_daemon` 时，浏览器被打开几十次。Codex 单 session 几百 event，
每个在 daemon 启动窗口内都触发 `maybeSpawnDaemon`（无去重），产生几十个
`serve --quiet` 进程 race，输的那几十个走 `runServe` 复用路径，而复用
路径忽略了 `options.quiet` 直接开浏览器。

**Scope 落地**
- `packages/cli/src/commands/serve.ts`：reuse 路径 `if (!options.noOpen
  && !options.quiet) open(...)`，与 fresh-start 路径对齐；`ServeOptions`
  新增 `openBrowser` 测试注入点。
- `packages/cli/src/transport.ts`：`maybeSpawnDaemon` 加 5s 冷却窗口
  （`lastSpawnAt` 模块级 state），同进程 5s 内最多 spawn 一次；导出
  `__resetMaybeSpawnDedupeForTest` 单测用。
- `serve.test.ts` 加 2 用例（quiet 模式 fresh-start / reuse 都不开
  浏览器）；`auto-spawn.test.ts` 加 2 用例（5 次连续 sendEvent 只
  spawn 1 次 / cooldown 过后允许再 spawn）。
- `packages/cli/package.json` 0.1.1 → 0.1.2。

**Not in**
- 不做跨进程 spawn 去重（OS 端口竞争已经保证只有一个 bind 成功）。
- 不改 `auto_spawn_daemon` 交互或默认值。

### 49-install-quieter (closed 2026-04-29)

**Why**
`iwr ... | iex` / `curl ... | sh` 首次安装时 npm 喷大量 transitive 依赖
warn（`peerOptional tree-sitter`、`deprecated prebuild-install`），用户看
了没法做任何事，反而掩盖真实错误。观感差。

**Scope 落地**
- `scripts/install.sh`：新增 `--verbose` flag；装 npm 时默认
  `--loglevel=error`，`--verbose` 切到 `--loglevel=notice`。help 文字区间
  `sed -n '2,20p'` 同步扩一行。
- `scripts/install.ps1`：新增 `[switch]$Verbose`；`$npmLogLevel =
  if ($Verbose) { 'notice' } else { 'error' }`；`npm install -g $pkg
  --loglevel=$npmLogLevel`。
- `packages/cli/src/install-scripts.test.ts` 加 2 用例 —— verbose 开关
  在两份脚本里可见、默认 `--loglevel=error` 字面存在；原 6 用例保留。
  含 PowerShell 语法解析，保证 `-Verbose` 在非 CmdletBinding 下不引入
  跟通用参数的冲突。
- `README.md` / `README.zh.md` Quick start 说明一行："默认只打印错误；
  需要排障加 `--verbose`（PS: `-Verbose`）"。

**Not in**
- 不改 npm progress bar（npm 10 在非 TTY 自动关闭，TTY 下保留无妨）。
- 不按 warn 文本做 grep 过滤（脆弱 + 不通用）。
- 不支持更低于 `error` 的层级（已是合理静默下限）。

### 48-init-detach-daemon (closed 2026-04-29)

**Why**
原先 `minspect init` 在同一进程 `await runServe()`，daemon 与执行 init 的
终端绑死 —— 关窗口即杀 daemon。与 `colima start` / `ollama serve` 一类
CLI 用户心智不符。

**Scope 落地**
- `packages/cli/src/commands/serve.ts` 新增/导出 `spawnServeDetached`、
  `waitForDaemonReady`、`findRunningDaemon`、`openBrowser`；`transport.ts::
  maybeSpawnDaemon` 改为复用 `spawnServeDetached`，消除 spawn 代码重复
- `packages/cli/src/commands/init.ts` 末尾不再 `await runServe`，改为
  pre-check `findRunningDaemon`（命中 → 打印 + open browser 即返回）→
  `spawnServeDetached({spawnedBy: 'init'})` → `waitForDaemonReady`
  最多 5s 轮询 `/health` → 打印 `http://127.0.0.1:PORT (pid N)` + open
  browser；init 自身退出
- `InitOptions` 新增 `findRunningDaemon` / `spawnServe` / `waitForDaemon` /
  `openBrowser` 测试注入点，避免单测碰真实子进程
- `init.test.ts` 新增 3 用例：spawn happy path / reuse running / spawn
  后 daemon 没起来（不崩、exit 0、提示手动跑 serve）

**Not in**
- 不改 `minspect serve` 本身（前台阻塞语义保留，便于 CI / docker / foreman
  场景）
- 不动 `auto_spawn_daemon` flag 的语义 —— 它管 hook，init 明确要起
  daemon 与该 flag 正交

### 47-install-oneliner (closed 2026-04-29)

**Why**
把 "npm i -g minspect" 压到一行 curl 或 PowerShell 命令，匹配 CLI 生态
`curl ... | sh` 的熟悉模式。

**Scope 落地**
- `scripts/install.sh` —— POSIX sh，验证 Node ≥ 20 → `npm install -g minspect`
  → 打印 `minspect init` 提示
- `scripts/install.ps1` —— PowerShell 等价
- 两侧都支持 `--version X` / `--skip-init`（PS 下 `-Version` / `-SkipInit`）
- 6 个结构测试：文件存在 / Node 20 floor 对齐 / 参数签名一致 / 不引入
  `@minspect/cli` / `sh -n` 解析 / PowerShell 解析
- README Quick start 改走一行 curl 路径，`npm i -g` / 源码路径作后备

**Not in**
- 二进制 release（pkg / bun / 零 Node 依赖）—— 后续卡
- CI publish 工作流 —— 手工触发为主
- Homebrew tap / Scoop bucket

### 46-npm-single-package (closed 2026-04-29)

**Why**
`pnpm install + link` 源码路径替换成 `npm i -g minspect`。一个命令搞定分发。

**Scope 落地**
- `packages/cli/scripts/bundle.mjs` — esbuild bundler：entry `src/bin.ts`，
  target Node 20 CJS，native 依赖 external（better-sqlite3 + tree-sitter×6），
  `define: {'import.meta.url': '__importMetaUrl'}` 通过 banner const 兜底
- bundle 复制 `packages/ui/dist/spa/` → `dist-bundle/ui/`；写生成的
  `dist-bundle/package.json`（name: minspect，bin 指向 bin.cjs，engines node>=20，
  native deps 版本对齐 workspace）
- `@minspect/ui` 的 `getAppHtml()` / `getAppAssetsDir()` 新增 `MINSPECT_UI_DIR`
  env 覆盖；bundle banner 设为 bundle 目录的 ui/，让打包后仍能找到 SPA
- `packages/cli/package.json` 加 esbuild devDep + `bundle` script
- `.gitignore` 加 `dist-bundle/`
- 5 个新测试：bundle 运行成功、layout 正确、单 shebang、publish-ready
  package.json、workspace 零残留、大小 < 10 MB（实测 2.3 MB）
- 发布路径：README Quick start 暂保留 `pnpm install` 流程，`npm publish` 走手工

**Not in**
- `minspect install` 生成 hook 命令从"node 绝对路径"迁成"minspect in PATH"——
  留给后续卡（影响 install 现有测试）
- CI publish workflow：手工触发为主，暂不进 `.github/workflows/`
- 二进制单文件（pkg/bun）：卡 47

### 45-cli-default-status (closed 2026-04-29)

**Why**
无参 `minspect` 敲下去直接有东西看。用户第一时间想看的是 "running 没 / UI
在哪 / 装没装 hook"，不是帮助页。

**Scope 落地**
- 新 `packages/cli/src/commands/status.ts`，只读命令；`runStatus()` 返
  回 `StatusReport`；`formatStatusReport()` 渲染 5–6 行文本
- `bin.ts` 用 commander 的 `{ isDefault: true }` 让 `status` 成为无参
  默认 action；`--help` / `-h` 不受影响
- 输出包含：daemon 状态（running / stopped / none）+ port + pid + 
  `spawned_by` 非 user 时显式标注；queue / poisoned；最近 event age（无
  事件时 `no events yet`）；hook 安装状态 ✓/✗
- 未 init 时打印 "not initialized · run `minspect init`"
- `--json` 输出结构化 `StatusReport`
- 6 个新测试：fresh / 未初始化 / 装过 hook 无 daemon / 有 daemon.json 但
  端口不通（stopped）/ running 的格式 / spawned_by hook tag

### 44-cli-init (closed 2026-04-29)

**Why**
9 步（clone → build → link → install × N → install-post-commit → serve → …）
压到一条 `minspect init`。

**Scope 落地**
- 新命令 `minspect init [--yes]`，聚合：doctor 预检 → 检测 agent →
  交互装 Claude Code / OpenCode hook → Codex 30d import → git 仓
  post-commit → 首次问 auto_spawn_daemon → 起 daemon + open UI
- 所有步骤都 **复用既有函数**（`runInstall` / `runInstallOpenCode` /
  `installPostCommitHook` / `runImportCodexAll` / `readConfig|writeConfig`
  / `runDoctor` / `runServe`），init 不做新增实现
- `--yes` 非交互：装检测到的 agent、装 post-commit if git、保守不导入
  Codex、不开 auto_spawn
- 已装 hook 通过 doctor 预检识别，init 跳过不重装；重复运行幂等
- 6 个新测试：--yes 全装、交互 n 全拒、已装跳过、git 仓 post-commit、
  auto_spawn 首次持久化不重问、空检测 happy path

### 43-cli-auto-spawn-daemon (closed 2026-04-29)

**Why**
装完 hook 就期望"开聊能看数据"。之前没 `minspect serve` 事件只会进 disk-queue。
必须是用户知情开启——后台进程悄悄运行会让人反感。

**Scope 落地**
- 新 `packages/cli/src/config.ts`：`readConfig()/writeConfig()` 读写
  `<state_dir>/config.json`，目前只一个 key `auto_spawn_daemon: boolean`
- `transport.ts::sendEvent` 在"no target"分支新增 `maybeSpawnDaemon()`：
  config 里 `auto_spawn_daemon: true` 则 detached spawn
  `node <bin> serve --quiet`（`detached: true, stdio: 'ignore', windowsHide: true`），
  env 传 `MINSPECT_SPAWNED_BY=hook`。立即 return queued，不等 daemon。
- `serve.ts` 新 `--quiet` flag：不打 banner、不 open browser；但仍写 state.json
- daemon.json 新增 `spawned_by: 'user' | 'init' | 'hook'`（`DaemonState` 类型扩展）
- `/api/build-info` 返回 `spawned_by`；UI status bar 在 `spawned_by === 'hook'`
  时显示"auto-started"绿色 chip（鼠标悬停说明"this daemon was auto-spawned by a hook"）
- config 默认不写；卡 44 `minspect init` 首次交互时问是否启用
- 7 个新测试：4 config round-trip / malformed / 路径 + 3 auto-spawn
  （spawn mock: 未配置不 spawn、配置 true spawn 参数正确、有 daemon 不 spawn）

### 42-cli-doctor (closed 2026-04-29)

**Why**
出问题时（hook 没装 / daemon 没起 / DB 不可写 / agent 没跑）用户逐条排查
成本高。需要一条命令一次过所有检查。

**Scope 落地**
- 新命令 `minspect doctor`，8 项检查、每项 ✓/⚠/✗ + 可选 `fix:`
- 检查：node 版本、state dir、daemon（state.json + /health 1s timeout）、
  Claude Code settings hook、OpenCode 插件、post-commit（非 git 仓 skip）、
  history.sqlite 存在、/api/sessions 近 5 min 活动
- `--json` 结构化输出（无 ANSI 色码），键名同内部 DoctorReport
- 退出码：有 fail → 1，否则 0（warn 不算错）
- 6 个新测试：fresh / install 后 / git 仓 post-commit / DB / stale daemon
  port / format 渲染

### 41-cli-uninstall (closed 2026-04-29)

**Why**
卸载之前要求用户手改 `~/.claude/settings.json` 找 `__minspect_managed__: true`
的 block 删掉——文档教学级别，不是机器可撤销。

**Scope 落地**
- 新命令 `minspect uninstall`，`--agent <a>` / `--all` / `--purge` / `--yes`
- 默认 dry-run：打印每一步"will remove"；`--yes` 才写。
- Claude Code：strip `__minspect_managed__: true` 的 hook entry，空数组/空
  hooks 对象一并清理；保留 user hooks；写 `.bak.<ts>`。
- OpenCode：文件整份属于我们 → 删文件；否则 strip BEGIN/END 块保留其它
  用户代码。
- `--all` 另外撤 cwd git 仓 post-commit（同样 block strip / 空即删）+ 停
  daemon（runStop 复用）。
- `--purge`：删 `history.sqlite` + WAL/SHM + `sessions/` + `queue/`。
- 10 个新测试：dry-run、idempotent、用户 hook 保留、整份删 vs strip、`--all`
  组合、`--purge` state、missing settings.json gracefully。

### 40-cli-fixed-port (closed 2026-04-29)

**Why**
`minspect serve` 之前每次监听随机端口，导致 UI 书签无法固定，reload 丢
localStorage（lang / theme / dashboard range 按 origin 隔离）。

**Scope 落地**
- `serve.ts` 导出 `DEFAULT_PORT = 21477`；`runServe` 新增 `startServerWithFallback`
- `ServeOptions.port` 语义：`undefined` = 默认 + 21477…21486 fallback；`0` = OS 随机；其它数值 = 明指不 fallback
- 占用时 stdout 打印 `defaulted to N because 21477 was busy`
- 全域 fallback 都失败 → 抛 `could not bind any port in [21477, 21486]`
- 测试：`port: 0` 隔离跑；新增 fallback 用例（起 net.Server 占 21477，verify runServe 落到 21478+；dev 机已占则自动跳过）

### 38-adapter-opencode-real (closed 2026-04-28 — CLI part)

**Scope 落地（CLI 侧）**
- 新子命令 `minspect capture-opencode`：stdin → parse → send，持久化 `opencode-<session_id>.json`
- `install --agent opencode` 分支：写 plugin 文件（user / project scope），幂等 + 备份；plugin 文件内 spawn + unref 子进程调 `capture-opencode`
- `@minspect/cli` 加 `@minspect/adapter-opencode` workspace 依赖
- 9 新测试（4 capture + 5 install）

> 完整记录：adapter spec 的 OpenCode 章节 + `minspect/archive/38-adapter-opencode-real.md`。

### 10-cli-serve-bundle (closed 2026-04-27)

**Why**
单入口启动 daemon + UI，降低用户认知负担。

**Scope 调整**
- 原要求 detached 后台模式；MVP 改前台（Ctrl-C 退）。接口（`ServeHandle.stop`）预留未来实现 detached，`runStop` 逻辑可复用。

**Scope / Acceptance**
- 启动/复用/--no-open/stop 全部单测。
- `findRunningDaemon` 用 PID kill(0) + /health 双重活性判定。
- 跨平台 `openBrowser` 实现（win start / macOS open / linux xdg-open），全 detached + unref。

> 详见 `minispec/archive/10-cli-serve-bundle.md`.

### 06-git-commit-link (closed 2026-04-27)

**Why**
让每条 edit 在用户 commit 后自动关联到 commit_sha；review 视图才能讲清"这个 commit 里 AI 改了什么"。

**Scope**
- In: core schema + migration 加 `commit_links.confidence`；collector `/commit-links` + `linkCommit()`；cli `link-commit` + `installPostCommitHook`；4+3+4 新测试。
- Out: squash/rebase 精确归因；跨 repo / worktree。

**Acceptance（全部通过）**
- 普通 commit → 按文件 + 时间窗匹配落 `commit_links`。
- 首次 commit（无 HEAD~1）→ git show 兜底。
- merge commit → CLI 检测 parent>1 跳过。
- install 保留用户自有 post-commit 内容，幂等加 `# >>> minspect managed >>>` 块 + 备份。
- confidence 可传；默认 1.0。

**Notes**
- 启发式：file_path + 时间窗（默认 24h）；复杂归因（diff 内容匹配）留后续。
- Windows：`rmSync` EPERM（git 子进程句柄）→ 测试清理走 `{maxRetries, retryDelay}`；根 vitest 加 `pool: forks / singleFork` 序列化消除 flaky。

> 完整 Plan 与 Risks and Rollback：见 `minispec/archive/06-git-commit-link.md`.

### 05-cli-capture-install (closed 2026-04-27)

**Why**
Hook 入口 + 一键安装；没它 adapter 产出的 Event 没人发，collector 没人建 hook 就收不到。

**Scope**
- In: `paths.ts` 跨平台状态目录；`session-state.ts` 每会话状态；`queue.ts` 磁盘队列；`transport.ts` POST + drain；`commands/capture.ts` + `commands/install.ts`；`bin.ts` commander 入口；13 个单测。
- Out: `serve` 命令（卡 10）；Codex/OpenCode install（对应 adapter 卡）；post-commit 挂钩（卡 06）；正式 p95 性能基准。

**Acceptance（全部通过）**
- 完整 turn flow（SessionStart/Prompt/Pre/Post/Stop）端到端跑通，4 事件落 stub collector。
- Collector down → 事件落队列、capture 不阻塞。
- install 5 hook event 齐全 + 幂等 + 备份 + 拒绝 malformed + 保留用户 hook。

**Notes**
- 新增依赖：cli → `commander`；workspace deps `core` / `adapter-claude-code`。
- 全量测试偶发 flaky：`core/git.test.ts` 在并行跑下 Windows 易失败；单包稳定。后续如噪声大可上 vitest single-fork 或 test.concurrent(false)。

> 完整 Plan 与 Risks and Rollback：见 `minispec/archive/05-cli-capture-install.md`.
