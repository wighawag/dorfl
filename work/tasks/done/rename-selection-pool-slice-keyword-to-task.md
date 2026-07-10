---
title: Rename the SelectionPool auto-pick keyword 'slice' -> 'task' (config/CLI/env wire keyword, clean break)
slug: rename-selection-pool-slice-keyword-to-task
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: []
covers: []
---

> **AUTHORED 2026-06-23 (conductor + human, post-rename cleanup follow-up).** A live `slice` CURRENT-CONCEPT identifier the main rename drive missed: the auto-pick `SelectionPool` keyword `'slice'` (the brief-tasking pool). Verified-live; flagged by observation `cli-autopick-pool-keyword-still-slice.md` (captured during `complete-intake-slice-prd-to-task-brief-cutover`). User-facing wire keyword (config `selectionOrder`, the `--selection-order` CLI flag/help, the `DORFL_SELECTION_ORDER` env, the `drain`/`groom` presets). Clean break, no alias — matches the namespace/token precedents (`build-slice`->`build-task`, `autoSlice`->`autoTask`, intake `{slice,spec}`->`{task,brief}`).

## What to build

Rename the orderable auto-pick pool keyword `'slice'` -> `'task'` (the pool that tasks a taskable brief), CLEAN BREAK, no alias. The keyword should match the `build-task`/`task-brief` rungs and the `autoTask` gate already landed — the pool that produces `task`/`brief` selections should not be spelled `slice`.

### `select-order.ts` (the type + presets — the source of truth)
- `export type SelectionPool = 'build' | 'slice' | 'surface' | 'triage'` (~L35) -> `'build' | 'task' | 'surface' | 'triage'`.
- `SELECTION_POOLS` array entry `'slice'` (~L40) -> `'task'`.
- `SELECTION_ORDER_PRESETS`: `drain: ['build', 'slice', 'surface', 'triage']` (~L58) -> `['build', 'task', ...]`; `groom: ['surface', 'triage', 'build', 'slice']` (~L59) -> `[..., 'build', 'task']`.
- The JSDoc naming the pool (~L31 `slice — task a taskable brief`, ~L49-51) -> `task`.

### Readers' JSDoc/comments
- `select-priority.ts` (~L19, L39 `the **slice** pool (brief-to-task)`) -> `task`. (The namespace mapping is ALREADY `'task' | 'brief'` — only the pool-keyword spelling + its prose change; do NOT touch `SelectedNamespace`.)
- The CLI help text in `cli.ts` (~L1857, ~L2387): `build/slice/surface/triage` + `build,slice,surface,triage` -> `build/task/surface/triage` + `build,task,surface,triage`.
- `config.ts` (~L245-248), `do-config.ts` (~L250), `env-config.ts` (~L79), `repo-config.ts` (~L140) — the `build,slice,surface,triage` example strings + the `[build, slice, surface, triage]` preset prose -> `task`.

### Tests
Update every test asserting the keyword: `select-order.test.ts`, `select-priority.test.ts`, `config.test.ts`, `do-autopick.test.ts`, `do-config.test.ts`, `env-config.test.ts` (the `selectionOrder: ['slice', ...]` literals, the preset assertions, the env comma-form `build,slice,...`).

## KEEP verbatim
- The historical slug `autoslice-gate` / `autoSlice`-precedent references in JSDoc that name a past task/gate are immutable slugs — leave them (they are not the live keyword). The live keyword is the `SelectionPool` string token only.
- The `advance-autopick-lifecycle-pools` task slug stays verbatim.

## Acceptance criteria

- [ ] `SelectionPool` is `'build' | 'task' | 'surface' | 'triage'`; `SELECTION_POOLS` + both `SELECTION_ORDER_PRESETS` (`drain`/`groom`) use `'task'`; no `'slice'` pool keyword remains live in src.
- [ ] The CLI `--selection-order` help, the config/do-config/env-config/repo-config example strings all read `build/task/surface/triage` (no `slice`).
- [ ] No back-compat alias / dual-accept of `'slice'` (clean break); an explicit `selectionOrder` of `slice` is simply an invalid pool now (the existing invalid-pool error path covers it).
- [ ] Immutable historical slugs (`autoslice-gate`, `advance-autopick-lifecycle-pools`) kept verbatim.
- [ ] All asserting tests renamed in this task; `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] No `.github/workflows/*` edited.

## Blocked by

- None — startable immediately. Independent src surface (the `select-order`/`select-priority`/config pool keyword), disjoint from the test-tidy task `rename-residual-slice-test-labels-and-skill-provenance` and the fixture compat-seam task `clean-break-fixture-folder-vocab-compat-seam`.

## Prompt

> Goal: rename the auto-pick `SelectionPool` keyword `'slice'` -> `'task'` (clean break, no alias), per brief `code-identifier-slice-prd-to-task-brief-rename`. This is a live user-facing config/CLI/env wire keyword (the pool that tasks a brief), the last live `slice` current-concept token in the selection surface; observation `cli-autopick-pool-keyword-still-slice.md` flagged it.
>
> FIRST verify reality: confirm `select-order.ts` still defines `SelectionPool = 'build' | 'slice' | 'surface' | 'triage'` and the `drain`/`groom` presets still carry `'slice'`. If already renamed, reconcile.
>
> Where to look: `select-order.ts` (type + `SELECTION_POOLS` + `SELECTION_ORDER_PRESETS` + JSDoc), `select-priority.ts` (JSDoc only — `SelectedNamespace` is already `task|brief`, do NOT touch it), `cli.ts` (the `--selection-order` help ~L1857/L2387), `config.ts`/`do-config.ts`/`env-config.ts`/`repo-config.ts` (example strings), and the asserting tests (`select-order`/`select-priority`/`config`/`do-autopick`/`do-config`/`env-config`). KEEP the historical slugs `autoslice-gate`/`advance-autopick-lifecycle-pools` verbatim. Run `pnpm format`.
>
> Done = build/test/format:check green, `SelectionPool` is `build|task|surface|triage`, no live `'slice'` keyword, no alias, no workflow touched.

---

### Claiming this task

```sh
dorfl claim rename-selection-pool-slice-keyword-to-task --arbiter <remote>
git fetch <remote> && git switch -c work/rename-selection-pool-slice-keyword-to-task <remote>/main
git mv work/tasks/todo/rename-selection-pool-slice-keyword-to-task.md work/tasks/done/rename-selection-pool-slice-keyword-to-task.md
```
