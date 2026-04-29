---
id: 20260429-cli-init
status: closed
owner: ivenlau
---

# Why

把"装完到能看数据"的 9 步降到 1 步：`minspect init`。聚合检测已装 agent、
装对应 hook、起 daemon、开 UI，并在 git 仓里顺手问 post-commit hook、首次
问 auto_spawn_daemon 开关。

# Approach

- Considered:
  - 纯批处理（无交互，装所有能装的）：快但用户没掌控感。
  - 交互问答：TTY 友好但 CI/脚本跑会卡。
  - 交互 + `--yes`：默认交互；`--yes` 全自动，保守默认（装检测到的 agent、
    不启 auto_spawn、装 post-commit 如果在 git 仓）。
- Chosen: 交互 + `--yes`。底层复用卡 42 doctor 的 agent 检测函数 + 卡 41
  install 的 managed-block 写入 + 卡 43 config util。

# Scope

- In:
  - `packages/cli/src/commands/init.ts` 流程：
    1. 跑 doctor 检查一次（复用），输出当前环境。
    2. 检测可装 agent：`~/.claude/settings.json` 存在 → 可装 claude-code；
       `~/.config/opencode/` 存在 → 可装 opencode 插件；`~/.codex/sessions/`
       存在 → 可导入 codex 历史。
    3. 问：装 claude-code？装 opencode？导入 codex（`--since 30d`）？
    4. 当前目录是 git 仓 → 问装 post-commit hook？
    5. 问开启 auto_spawn_daemon？（default No）
    6. 起 daemon（`serve --quiet`），open browser 到 UI；若 daemon 已在跑则跳过起。
    7. 跑 doctor 一次输出最终状态。
  - `bin.ts` 新 command `init`；`--yes` 非交互；`--agent <list>` 手工限定。
- Out: 覆盖用户已改过的 agent 设置（install 本身 idempotent，若用户关了
  hook 不会主动帮其开）。

# Acceptance

- [ ] Given 干净机器 + 已装 Claude Code, When `minspect init`, Then 依次交
      互完成 hook 装 + daemon 起 + 浏览器打开 UI；`minspect doctor` 全绿。
- [ ] Given 已装过部分 hook, When 重入 init, Then 跳过已装项（打印
      "already installed"）不重装。
- [ ] Given `--yes`, Then 全流程无 prompt；保守默认（auto_spawn off）。
- [ ] Given 非 git 仓, Then 跳过 post-commit hook 问题。
- [ ] Given init 完成后立即开 agent 对话, Then UI 收到事件（daemon 已起）。

# Plan

- [ ] T1 `init.ts` 主流程 + 最简 prompt 工具（readline 原生，避免新依赖；
      只接受 y/N）。
- [ ] T2 复用：卡 42 的 agent 检测、卡 41 的 install utils、卡 43 的 config
      util、卡 40 的固定端口。
- [ ] T3 `bin.ts` 加 command + `--yes` + `--agent <a,b>` 限定。
- [ ] T4 `init.test.ts`：干净 / 已装 / git / 非 git / `--yes` / 中途 Ctrl-C
      不留半启动状态。
- [ ] T5 README Quick start 章节重写为：
      ```
      npm i -g minspect
      minspect init
      ```
- [ ] T6 `minispec/specs/cli.md` 记录 init 流程与复用关系。

# Risks and Rollback

- Risk: readline 在某些 PS 版本 UTF-8 乱码。缓解：prompt 文本保持 ASCII；
  接受 y/n 单字符。
- Risk: init 中途异常退出 → 部分 hook 装、部分没装。缓解：每步是独立
  idempotent 操作，重跑 init 能续上。
- Rollback: 保留 install / install-post-commit-hook 命令，用户可分步跑。

# Notes

- 本卡是本系列的"主卡"，依赖 40/41/42/43 全部落地后体验才完整；但由于每步
  都复用既有命令底层，本卡可独立开发，依赖缺的部分以 fallback 文字代替
  （例如 auto_spawn 开关缺失时跳过那一问）。
