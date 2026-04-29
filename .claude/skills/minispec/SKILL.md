---
name: minispec
description: Lightweight spec-first workflow for coding tasks.
---

<!-- canonical source: minispec/SKILL.md; keep mirrors' `## Guardrails` in sync. -->

# minispec

Lightweight spec-first workflow for coding tasks.

## Trigger

Use this skill when user asks to plan or implement a code change and wants small, clear, acceptance-based execution.

## Required Context

- `minispec/project.md`
- `minispec/specs/`
- `minispec/changes/`
- `minispec/archive/`
- `minispec/templates/change.md`

## Commands

Support six actions:

- `project [context]`
- `new <idea>`
- `apply <change-id>`
- `check <change-id>`
- `analyze <quick|normal|deep>`
- `close <change-id>`

Plus two ceremony-control commands:

- `pause [--reason "<text>"]`
- `resume`

Plus three lifecycle commands (user-facing, not agent-driven):

- `upgrade [<dir>]` — refresh agent files from the installed CLI share.
- `remove [<dir>]` — delete minispec scaffolding from a project (destructive; interactive by default).
- `uninstall` — remove the global CLI (launcher + share directory + Windows PATH entry).

## Pause Awareness

Before interpreting a user request as a minispec action (`new` / `apply` / `check` / `close` / `analyze`), check for `minispec/.paused`:

- If the marker exists AND the user's request does NOT explicitly invoke `minispec <action>` (or reference a specific change card by id), treat the request as a normal coding task — no card, no propose, no merge. Guardrails still apply.
- If the marker exists AND the user explicitly invokes a minispec action, honor the invocation (explicit intent overrides the pause default).
- While paused, mention it briefly in your first response of the session ("minispec is paused; run `minispec resume` to re-enable"). Don't repeat the reminder in every message.

## Behavior

### new

1. Read `minispec/project.md`.
2. Read `minispec/specs/README.md` and related domain specs if they exist.
3. Clarify before committing — ask ONE question at a time:
   - Surface purpose (what outcome the user wants), constraints (what must not change, what bounds scope), and success criteria (how we know it works).
   - Don't batch 4 questions into one paragraph — back-and-forth is cheaper than misaligned assumption.
   - Stop asking once `Why` / `Scope` / `Acceptance` can be written without guessing. If the problem has a single reasonable path, name it and move on.
4. Propose 2–3 approaches:
   - Name each briefly; list concrete trade-offs (cost, risk, maintenance, scope bleed) per approach; end with your recommendation and the decisive trade-off.
   - Wait for the user's choice (or their explicit "go with your pick") before writing the card.
   - If only one approach is reasonable, skip this step and say so in the card's `Approach` section.
5. Create one new file in `minispec/changes/` using `minispec/templates/change.md`.
6. Fill `Why`, `Approach`, `Scope`, `Acceptance`, and an initial `Plan`, all reflecting the chosen approach.
7. Keep it short and testable.

### project

1. Generate `minispec/project.md` as the first step for new adoption.
2. Existing project: auto-detect stack and likely commands.
3. New project: infer from user context or generate guided fields.
4. Tell user this is an editable draft and ask for corrections.
5. Prefer in-context generation over `ms-project.*`; fall back to the script only when running without an AI agent. When generating in-context:
   - Create or refresh `minispec/project.md` using this contract structure:
     - `## Stack` (`Language`, `Framework`, `Runtime`) [auto-managed]
     - `## Commands` (`Install`, `Build`, `Test`, `Lint`) [auto-managed]
     - `## Engineering Constraints` [manual-managed]
     - `## Non-Goals` [manual-managed]
     - `## Definition of Done` [manual-managed]
     - `## Generation Metadata` (source, mode, context) [auto-managed]
     - `## Guided Inputs` [auto-managed when unresolved]
   - If `minispec/project.md` already exists, apply merge strategy:
     - update only auto-managed sections
     - preserve manual-managed sections
     - if boundaries are ambiguous, create `.bak.<YYYYMMDDHHmmss>` first
   - Add optional `## Maintainer Notes` as manual-managed section when needed.
   - If stack detection is uncertain, use explicit guided placeholders (`TBD`) instead of guessing.

### apply

1. Open target file in `minispec/changes/<id>.md`.
2. Execute plan tasks in order and keep scope tight.
3. After each completed task, mark the checkbox as done.
4. If scope changes, update `Scope` and add one acceptance item before coding more.
5. Do not close the card in this action.

### check

1. Validate each acceptance item with evidence.
2. Run tests and lint commands defined in `minispec/project.md`.
3. Append short notes for pass or fail outcomes.

### analyze

1. Generate or refresh canonical analysis docs in `minispec/specs/`.
2. Execute analysis directly in Code CLI model context.
3. Modes:
   - `quick`: project-level summary.
   - `normal`: project + subproject/module analysis.
   - `deep`: project + subprojects + logic hotspot analysis.
4. Refresh `minispec/specs/README.md` with analysis snapshot and referenced docs.
5. Generate docs by mode:
   - always `project-map.md`
   - normal/deep add `subprojects.md`
   - deep add `logic-deep-dive.md`
6. Preserve `## Maintainer Notes` from existing specs README.
7. Mark deep findings as heuristic where appropriate.

### close

1. Confirm all acceptance items are complete.
2. Update canonical domain spec under `minispec/specs/`.
3. Mark card as `status: closed`.
4. Move card to `minispec/archive/`.

The canonical spec only captures `Why`, `Scope`, `Acceptance`, and `Notes`. `Plan` and `Risks and Rollback` remain in `minispec/archive/<id>.md`; the merged spec block should cross-reference the archive file so readers can recover the full context.

## Guardrails

- No dependency additions without explicit approval.
- No broad cleanup outside scope.
- No close action if acceptance is incomplete.
