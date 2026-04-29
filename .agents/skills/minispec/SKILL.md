---
name: minispec
description: Lightweight spec-first workflow for coding tasks.
---

<!-- canonical source: minispec/SKILL.md; keep mirrors' `## Guardrails` in sync. -->

# minispec

Lightweight spec-first workflow for coding tasks.

## Use This Skill When

- The user asks to implement or change behavior.
- The scope is unclear and needs a short acceptance-driven spec.
- You need traceability from intent to code changes.

## Inputs

- Action: `project`, `new`, `apply`, `check`, `analyze`, or `close`.
- Ceremony control: `pause [--reason "<text>"]` or `resume`.
- Lifecycle (user-facing, not agent-driven): `upgrade [<dir>]`, `remove [<dir>]`, `uninstall`.
- Optional change id, for example: `20260323-refund-filter`.
- Optional user request text.

## Pause Awareness

Before interpreting a user request as a minispec action (`new` / `apply` / `check` / `close` / `analyze`), check for `minispec/.paused`:

- If the marker exists AND the user's request does NOT explicitly invoke `minispec <action>` (or reference a specific change card by id), treat the request as a normal coding task — no card, no propose, no merge. Guardrails still apply.
- If the marker exists AND the user explicitly invokes a minispec action, honor the invocation (explicit intent overrides the pause default).
- While paused, mention it briefly in your first response of the session ("minispec is paused; run `minispec resume` to re-enable"). Don't repeat the reminder in every message.

## Directory Contract

- `minispec/project.md`: project constraints and commands.
- `minispec/specs/`: canonical shipped behavior.
- `minispec/changes/`: active change cards.
- `minispec/archive/`: closed change cards.
- `minispec/templates/change.md`: change template.

## Action: new

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

## Action: project

1. Generate or refresh `minispec/project.md` before first change card.
2. For existing repositories, detect stack and commands from project files.
3. For new repositories, infer from user context or use guided placeholders.
4. Ask user to review and refine generated commands before implementation.
5. Prefer in-context generation over `ms-project.*`; fall back to the script only when running without an AI agent. When generating in-context:
   - Create or refresh `minispec/project.md` using this contract structure:
     - `## Stack` (`Language`, `Framework`, `Runtime`) [auto-managed]
     - `## Commands` (`Install`, `Build`, `Test`, `Lint`) [auto-managed]
     - `## Engineering Constraints` [manual-managed]
     - `## Non-Goals` [manual-managed]
     - `## Definition of Done` [manual-managed]
     - `## Generation Metadata` (source, mode, context) [auto-managed]
     - `## Guided Inputs` [auto-managed when unresolved]
   - If `minispec/project.md` exists, apply merge strategy:
     - update only auto-managed sections
     - preserve manual-managed sections as-is
     - if section boundaries are ambiguous, create `.bak.<YYYYMMDDHHmmss>` before refresh
   - Add an optional manual section when helpful:
     - `## Maintainer Notes` [manual-managed]
   - If stack detection is uncertain, use explicit guided placeholders (`TBD`) instead of guessing.

## Action: apply

1. Open target file in `minispec/changes/<id>.md`.
2. Execute plan tasks in order and keep scope tight.
3. After each completed task, mark the checkbox as done.
4. If scope changes, update `Scope` and add one acceptance item before coding more.
5. Do not close the card in this action.

## Action: check

1. Open target change card and validate every acceptance line.
2. Run commands from `minispec/project.md` where available (`test` and `lint` first).
3. Record validation notes under `Notes` in the change file.
4. If any acceptance item fails, leave status as `draft` or `in_progress`.

## Action: analyze

1. Generate or refresh canonical analysis docs under `minispec/specs/`.
2. Execute analysis directly in Code CLI model context.
3. Support levels:
   - `quick`: project-level overview.
   - `normal`: project + subproject/module boundaries.
   - `deep`: project + subprojects + method/logic hotspots.
4. Auto-update `minispec/specs/README.md` with:
   - analysis snapshot
   - referenced generated docs
   - maintenance model
5. Generate level-dependent referenced docs:
   - always: `project-map.md`
   - normal/deep: `subprojects.md`
   - deep: `logic-deep-dive.md`
6. Preserve manual section in `minispec/specs/README.md`:
   - `## Maintainer Notes`
7. If uncertain, mark findings as heuristic and avoid fabricated certainty.

## Action: close

1. Ensure all acceptance checkboxes are complete.
2. Update the relevant file in `minispec/specs/` with final shipped behavior.
3. Set frontmatter `status: closed` in the change file.
4. Move the change file from `minispec/changes/` to `minispec/archive/`.

The canonical spec only captures `Why`, `Scope`, `Acceptance`, and `Notes`. `Plan` and `Risks and Rollback` remain in `minispec/archive/<id>.md`; the merged spec block should cross-reference the archive file so readers can recover the full context.

## Output Style

- Keep updates concise and concrete.
- Always reference file paths changed.
- Separate assumptions from confirmed facts.

## Guardrails

- No dependency additions without explicit approval.
- No broad cleanup outside scope.
- No close action if acceptance is incomplete.
