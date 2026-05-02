# minspect

[English](README.md) · [中文](README.zh.md)

> Git blame for AI coding agents — record what every agent changed, why, and through which prompts, down to the line.

`minspect` runs as a local daemon that hooks into AI coding CLIs (Claude Code, Codex CLI, OpenCode) and captures every edit as it happens. It reconstructs a **session → turn → prompt → reasoning → hunk → line** chain so you can answer:

- "Which prompt introduced this line?"
- "What was the agent thinking when it made this change?"
- "What did the AI touch in the commit I'm about to push?"

Everything is local. No cloud, no account, no telemetry. Data lives in a single SQLite file under your state dir.

## Status

Working on Windows, macOS, and Linux with Node 20+. 351 tests across the workspace, lint + build clean.

| Agent       | Method                                 | Status                                                   |
| ----------- | -------------------------------------- | -------------------------------------------------------- |
| Claude Code | Native hooks                           | Full support (edits, reasoning, commit-link)             |
| Codex CLI   | Session-log import (`rollout-*.jsonl`) | Full support (apply_patch → line blame)                  |
| OpenCode    | Plugin (`event` / `tool.execute.*`)    | Full support (edits, reasoning, file path attribution)   |

## Quick start

### 1. Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/ivenlau/minspect/main/scripts/install.sh | sh
```

Windows (PowerShell):

```powershell
iwr https://raw.githubusercontent.com/ivenlau/minspect/main/scripts/install.ps1 | iex
```

Both scripts check Node ≥ 20 and run `npm install -g @ivenlau/minspect`. Output is
limited to errors by default — pass `--verbose` (PowerShell: `-Verbose`) if you need
npm's full `peerOptional` / `deprecated` warnings for debugging. If you prefer `npm`
directly:

```bash
npm install -g @ivenlau/minspect
```

Or from source:

```bash
pnpm install
pnpm -r build
pnpm -C packages/cli link --global
```

### 2. Run `minspect init`

```bash
minspect init
```

That detects which agents you have, interactively installs their hooks
(Claude Code / OpenCode), optionally imports the last 30 days of Codex
sessions, installs the post-commit hook if you're in a git repo, asks once
whether hooks should auto-start the daemon, then starts `serve` and opens
the UI on `http://127.0.0.1:21477`. Pass `--yes` for non-interactive.

Re-running `init` is safe — anything already wired is skipped.

### 3. Use your AI as normal

Chat with Claude Code / Codex / OpenCode as you always would. Every edit, tool call, prompt, and piece of agent reasoning is recorded in the background.

### 4. Review

In the web UI:

- **Dashboard** — activity chart (today / week / 30 days / year), top workspaces, top agents, recent alerts
- **Timeline** — sessions in reverse chronological order across every workspace
- **Session → Files** — per-file edit counts, click through to blame
- **Blame** — every line coloured by the turn that wrote it; click a line to see the prompt, agent's thinking, and the final message
- **Review** — all edits in a session with inline diffs, filter by file / keyword / level, export to self-contained HTML for PR attachments
- **Replay** — step through tool calls one at a time with keyboard navigation (←/→, Home/End, Space for autoplay)
- **Revert** — "Revert this turn" button on Review cards and Replay steps; opens a preview modal and generates a copyable CLI command
- **Command palette** (⌘K / Ctrl+K) — cross-session FTS5 search over prompts, reasoning, tool-call explanations, and file paths
- **EN / 中 toggle** — full Chinese translation next to the theme toggle

## Everyday commands

```bash
minspect                          # default: status (daemon, queue, last event, hooks)
minspect init                     # one-shot setup (re-runnable)
minspect serve                    # start the daemon + UI (port 21477)
minspect stop                     # stop the daemon
minspect doctor                   # 8-point diagnostic
minspect uninstall --all --yes    # symmetric to install (--purge also wipes state)
minspect import-codex --latest    # manually import a Codex rollout
```

## Reverting AI changes

`minspect` keeps every before/after snapshot, so it can restore files to the state they were in before a specific turn or edit:

```bash
# Dry-run first — see what would change
minspect revert --turn <turn_id>

# Actually write to disk
minspect revert --turn <turn_id> --yes

# Revert a single edit (one file)
minspect revert --edit <edit_id> --yes

# Override drift detection (use only if you know the file has diverged since)
minspect revert --turn <turn_id> --yes --force
```

Safety guarantees:
- **Dry-run by default** — you must pass `--yes` to actually write.
- **Drift detection** — if the file on disk has been modified since `minspect` last recorded it, revert aborts (override with `--force`).
- **Codex hard-block** — Codex-imported sessions are refused because their patch logs only capture hunk windows, not full files; restoring would clobber unrelated regions. Use `git checkout` for Codex sessions.
- **Chain-break warnings** — if user edits are detected between the target and the current state, they're listed before you confirm.
- **Server-side stays read-only** — the collector never writes to your workspace. The CLI is the only path to disk.

The UI Review / Replay pages also have "Revert this turn" buttons that open a preview modal and generate the exact CLI command to copy.

## Importing existing Codex sessions

Codex has no hook API, so its logs are imported after the fact:

```bash
# Newest session
minspect import-codex --latest

# Specific session by path or UUID
minspect import-codex --session rollout-2026-02-26T16-22-56-019c990b-3d80-73a0-baa0-ebd4b1c3f87d.jsonl
minspect import-codex --session 019c990b

# Bulk import anything in the last 30 days (also what the sidebar refresh
# button does, plus a background hourly import with `--since 1d`)
minspect import-codex --all --since 30d
```

Re-import is idempotent — Codex's own UUIDs become stable primary keys.

## How it works

```
┌─ agent (Claude Code / Codex CLI / OpenCode)
│     │  hook fires  ─or─  session log written
│     ▼
├─ `minspect capture`  (short-lived; exits ≤100 ms; never blocks agent)
│     │  POST Event  ─or─  enqueue to disk if daemon down
│     ▼
├─ Collector daemon (Fastify + SQLite + WAL, default port 21477)
│     │  single-transaction ingest
│     ▼
├─ Indexer
│     ├─ structuredPatch diff → hunks
│     ├─ line blame propagation (hash chain; break on user edits)
│     ├─ tree-sitter AST (TS/JS/Python/Go/Rust/Java) for method-level aggregation
│     └─ post-commit hook → commit_links
│     ▼
└─ Web UI (React + Vite SPA, bundled into the daemon)
```

Key design choices:

- **Hooks never block the agent**: failures write to stderr and `exit 0`; network failures enqueue events to disk and drain on the next hook invocation.
- **Ingest is idempotent**: every INSERT uses `ON CONFLICT DO NOTHING` and IDs are deterministic (`edit_id = ${tool_call_id}:${idx}`), so disk-queue replay is safe.
- **Agent reasoning comes from the agent itself**: we extract the "I'll edit X because …" preamble Claude Code writes to its transcript (or Codex writes to `agent_reasoning` events). **No extra LLM calls, no API key.** A standalone LLM explainer remains as an opt-in fallback for agents without reasoning output.
- **Blame chains break cleanly on user edits**: if `before_hash` of edit N+1 doesn't match `after_hash` of edit N, the chain resets rather than mis-attributing your changes to the AI.

## Repository layout

```
packages/
├── core/                 — Event schema (zod), DB schema, migrations, git helpers
├── collector/            — Fastify server, SQLite store, blame + AST indexers,
│                           LLM explainer (opt-in), Claude-Code transcript parser
├── cli/                  — `minspect` binary: init, status, serve, stop, doctor,
│                           capture, capture-opencode, install, uninstall,
│                           import-codex, link-commit, revert, vacuum
├── ui/                   — React + Vite SPA (dark/light theme, EN/zh i18n);
│                           built output bundled into the collector
└── adapters/
    ├── claude-code/      — hook payload → Event; transcript reasoning extraction
    ├── codex/            — rollout-*.jsonl parser + apply_patch → file_edits
    ├── opencode/         — plugin envelope → Event (edit / write / reasoning)
    └── aider/            — skeleton (reserved)
```

## Scripts

```bash
pnpm build      # tsc across all packages
pnpm test       # vitest across all packages (~351 tests)
pnpm lint       # biome check .
pnpm format     # biome format --write .
```

Note: biome's `format` command does not reorganize imports. When adding/moving imports, run `pnpm exec biome check --write .` instead.

## Releasing

Publishing is automated via GitHub Actions. Push a `v`-prefixed tag and CI handles the rest:

```bash
# 1. Bump version in packages/cli/package.json
npm version 0.2.0 --no-git-tag-version

# 2. Commit and tag
git add -A && git commit -m "release: v0.2.0"
git tag v0.2.0

# 3. Push — CI takes over: build → bundle → test → npm publish → GitHub Release
git push && git push --tags
```

The workflow (`.github/workflows/publish.yml`) validates that the tag version matches `packages/cli/package.json` before publishing. If they don't match, CI fails.

**Prerequisite**: the `NPM_TOKEN` secret must be configured in the repo's GitHub Actions settings (Settings → Secrets → Actions).

## Data and privacy

- SQLite file: `<state_dir>/history.sqlite` (WAL mode)
- State dir: `%LOCALAPPDATA%\minspect` (Windows) or `$XDG_STATE_HOME/minspect` (Linux/macOS; defaults to `~/.local/state/minspect`)
- Daemon state: `<state_dir>/state.json` — port / pid / started_at / spawned_by
- Per-session state: `<state_dir>/sessions/<session_id>.json` — turn counter, pre-edit file snapshots
- Disk queue (when daemon is offline): `<state_dir>/queue/<timestamp>-<uuid>.json`
- User config: `<state_dir>/config.json` — currently just `auto_spawn_daemon`

To wipe all history: `minspect uninstall --all --purge --yes` (or stop the daemon and delete `<state_dir>`).

Nothing leaves your machine unless you explicitly opt into the LLM explainer (`config.explainer.enabled = true`), in which case hunks are sent to Anthropic's API using your own key.

## Diagnosing problems

If things aren't working (no sessions in the UI, hook not firing, etc.) run:

```bash
minspect doctor
```

It prints 8 checks (Node version, state dir, daemon, installed hooks, DB, recent activity) with ✓/⚠/✗ and a `fix:` hint next to anything that's not ok. Use `--json` for a machine-readable report. Exits non-zero only when there's a hard failure (`✗`), so it's CI-friendly.

## Uninstall

```bash
# Preview what will be removed (dry-run)
minspect uninstall --all

# Apply: strip Claude Code + OpenCode hooks, stop daemon, remove cwd's
# post-commit hook if we installed one.
minspect uninstall --all --yes

# Also delete the SQLite DB and captured sessions (irreversible).
minspect uninstall --all --purge --yes
```

`uninstall` is symmetric to `install`: it only touches the blocks our hooks wrote (`__minspect_managed__: true` for Claude Code, `// >>> minspect managed >>>` markers for OpenCode and post-commit). User-authored hooks around those blocks are preserved, and every file touched gets a `.bak.<timestamp>` copy.

## Known limitations

- **Codex patch line numbers are hunk-relative, not absolute**: Codex's `apply_patch` format doesn't include full file contents, so line-level blame on Codex-edited files is relative to the changed region. Upgrade path documented in `minispec/specs/adapters.md`.
- **Merge commits aren't linked**: `link-commit` skips commits with `parent_count > 1`.
- **AST covers 6 languages**: TypeScript, JavaScript, Python, Go, Rust, Java. Other extensions fall back to whole-file nodes.
- **Inline diffs render as text-based `<pre>` blocks** (no Monaco / syntax highlighting yet).

## Development

Changes go through a lightweight spec workflow (`minispec`):

1. Open a change card in `minispec/changes/`
2. Apply + test + tick acceptance checkboxes
3. Close → merge rules into `minispec/specs/<domain>.md`, archive card

See `CLAUDE.md` for the full contract. Canonical specs live in `minispec/specs/`:

- [foundation.md](minispec/specs/foundation.md) — monorepo, tooling
- [core.md](minispec/specs/core.md) — Event schema, DB schema
- [collector.md](minispec/specs/collector.md) — server, ingest pipeline, blame/AST
- [adapters.md](minispec/specs/adapters.md) — per-agent parser rules
- [cli.md](minispec/specs/cli.md) — CLI commands and hook protocol
- [ui.md](minispec/specs/ui.md) — routes, API contract

The original product design doc: [`design.md`](design.md).

## License

MIT. See the repository at [github.com/ivenlau/minspect](https://github.com/ivenlau/minspect).
