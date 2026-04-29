# AGENTS

Repository default workflow uses minispec.

## Default Rule

For any behavior change, execute the minispec flow in this order:

1. `project` — generate or refresh `minispec/project.md`.
2. `new` — create or update a change card under `minispec/changes/`.
3. `apply` — implement only the planned tasks.
4. `check` — validate acceptance items and run project test/lint commands.
5. `analyze` — on demand (`quick` | `normal` | `deep`), refresh canonical analysis docs in `minispec/specs/`.
6. `close` — merge shipped behavior into `minispec/specs/<domain>.md` and move the card to `minispec/archive/`.

## Paths

- Skill path: `.agents/skills/minispec/SKILL.md`
- Project contract: `minispec/project.md`
- Canonical specs: `minispec/specs/`
- Active changes: `minispec/changes/`
- Archive: `minispec/archive/`

## Exceptions

Skip minispec only for:

- non-code conversational requests
- tiny one-line typo fix with no behavior impact
