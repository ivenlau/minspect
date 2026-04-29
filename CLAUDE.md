# CLAUDE

Use minispec as the default delivery workflow for behavior changes.

## Workflow Contract

Execute these six actions in order for any behavior change:

1. `project` — generate or refresh `minispec/project.md` (run once before the first change, re-run when stack or commands change).
2. `new` — create a change card in `minispec/changes/` from `minispec/templates/change.md` and fill Why / Scope / Acceptance / Plan.
3. `apply` — implement only the planned, accepted scope; tick Plan checkboxes as you go.
4. `check` — validate each Acceptance item; run project `Test` and `Lint` commands; record outcomes in Notes.
5. `analyze` — on demand (`quick` | `normal` | `deep`), refresh canonical analysis docs under `minispec/specs/`.
6. `close` — merge the change into `minispec/specs/<domain>.md`, set `status: closed`, move card to `minispec/archive/`.

## Skill

- `.claude/skills/minispec/SKILL.md`

## Context Files

- `minispec/project.md`
- `minispec/specs/`
- `minispec/changes/`
- `minispec/archive/`
- `minispec/templates/change.md`

## Exception Rule

Skip minispec only for trivial typo-only edits with no behavior change.
