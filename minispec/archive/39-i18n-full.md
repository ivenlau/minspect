---
id: 20260428-i18n-full
status: closed
owner: ivenlau
---

# Why

UI was English-only. User asked for a full (not partial) English/Chinese toggle
next to the theme toggle so the tool is usable by zh-first operators without
translating with an external tool or copy-pasting.

# Approach

- Considered:
  - react-i18next: industry standard, but brings a heavier runtime + ICU
    formatting surface we don't need, and its React integration requires a
    Provider wrapping the tree. Cost exceeds benefit for ~200 strings.
  - Home-grown table + module-level state + CustomEvent subscription.
- Chosen: home-grown. Matches the existing `theme.ts` pattern (module-level
  state + DOM event for cross-component updates), zero new deps, 200-line
  table is easy to diff in PRs, and the `useLang()` hook keeps the
  React-facing API familiar.

# Scope

- In: `packages/ui/src/i18n/{index.ts,strings.ts}` infra, `LangToggle`
  component wired into TopBar, translation of every user-facing string across
  pages/layouts/features, drift test + `t()` unit tests.
- Out: backend/CLI/adapter messages (daemon logs, capture error text).

# Acceptance

- [x] Given a fresh browser with no stored preference, When the UI loads,
      Then language resolves from `navigator.language` (zh* → zh, else en).
- [x] Given I click the EN/中 toggle, Then all visible strings flip and the
      choice persists across reloads via localStorage.
- [x] Given a new string key is added, Then the drift test fails unless
      both `en` and `zh` entries are non-empty.
- [x] Given I navigate across Dashboard / Timeline / Workspace / Session
      (Overview/Review/Replay/Files) / Blame / CommandPalette, Then nothing
      hardcoded in English remains in the JSX.
- [x] Given vitest + biome + tsc, Then all pass.

# Plan

- [x] T1 i18n infra + strings table + LangToggle component
  - Expected output: `i18n/index.ts`, `i18n/strings.ts`, `components/LangToggle.tsx`;
    TopBar slot; `import './i18n'` in `main.tsx` to warm initial lang.
- [x] T2 Translate every page + feature component
  - Expected output: 29 files updated; helpers that aren't components take
    `t` as argument (e.g. `topBarPropsFor(route, t)`, `unitLabel(range, t)`).
- [x] T3 Tests
  - Expected output: `i18n/i18n.test.ts` — drift test (every key has non-empty
    en+zh), `t()` behavior (interpolation, function values, missing-key
    fallback), `setLang` persistence + CustomEvent dispatch. 12 new tests,
    65 ui tests pass.

# Risks and Rollback

- Risk: variable shadowing where a map callback reuses `t` as its iteration
  variable (e.g. `turns.map((t) => ...)` clashes with `const { t } = useLang()`).
  Mitigation: caught once in SessionOverviewPage; renamed loop var to `turn`.
  No silent failures because biome flags unused-or-shadowed vars.
- Rollback: revert the i18n/ directory + un-wire `<LangToggle />` from TopBar.
  Strings inline in JSX in prior history.

# Notes

- `useLang()` subscribes to a `minspect:lang-change` CustomEvent so helper
  functions outside React (e.g. formatters in components/EmptyState consumers)
  keep working via the same module-level `t()` binding.
- `LangToggle` button text is `EN / 中`; the *tooltip* flips with current
  language so the affordance is always in the other language ("切换到英文" /
  "Switch to Chinese").
- No locale-aware number/date formatters added — existing ad-hoc `toLocaleString`
  calls already pick up browser language. If zh-specific date formatting is
  needed later, it can key off `getLang()` from the same module.
