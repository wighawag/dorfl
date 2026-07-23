---
title: 'Rename the work-layout symbolic KEYS and folder-union names to the new task/brief vocabulary (internal cleanup; values unchanged)'
slug: work-layout-keys-and-folder-union-names-to-new-vocabulary
blockedBy: []
covers: []
---

## What to build

The internal-vocabulary cleanup the `folder-taxonomy-reorg-and-rename` migration
deliberately deferred (slice `slice-task-prd-brief-vocabulary-hard-cutover`'s Gate-2
nit "internal symbol names kept on old words"). The migration flipped every folder
NAME (the VALUES in `work-layout`'s `WORK_FOLDER_NAME`) and the user-facing
vocabulary, but left several `work-layout` symbolic KEYS and folder-union
identifiers on the OLD words. They resolve correctly (the values are right) but read
as stale vocabulary and contradict their own docstrings (e.g. `terminalMainPaths`
calls `workItemRel('spec-sliced', …)` while its docstring says "a BRIEF:
`work/briefs/tasked/…`").

Rename the KEYS (NOT the values — the on-disk folders do NOT move; this is a pure
in-code symbol rename) and the union/type names to the new vocabulary:

- `WORK_FOLDER_NAME` keys: `pre-backlog → tasks-backlog`, `backlog → tasks-todo`,
  `pre-spec → briefs-proposed`, `spec → briefs-ready`, `spec-sliced → briefs-tasked`.
  (`briefs-dropped`, `done`, `cancelled`, `observations`, `ideas`, `findings`,
  `questions`, `protocol`, `in-progress`, `needs-attention` are already clean —
  leave them.) The VALUE strings (`'tasks/todo'`, `'briefs/ready'`, …) are
  byte-identical before and after — only the left-hand key changes.
- The folder-union arrays + their types that still carry slice/spec vocabulary:
  `SLICE_RESOLUTION_FOLDERS`/`SliceResolutionFolder`,
  `SLICE_LIFECYCLE_FOLDERS`/`SliceLifecycleFolder`, `PRD_FOLDERS`/`PrdFolder`, and the
  re-exported `SliceFolder` aliases. Rename to task/brief vocabulary
  (e.g. `PRD_FOLDERS → BRIEF_FOLDERS`, `PrdFolder → BriefFolder`,
  `SLICE_*_FOLDERS → TASK_*_FOLDERS`, `SliceFolder → TaskFolder`), updating every
  consumer (`prompt.ts`, `spec-complete.ts`, `close-job.ts`, `ledger-lint.ts`,
  `integration-core.ts`, `item-lock.ts`, `index.ts` re-exports, and the tests).
- Refresh the now-correct docstrings that referenced the old keys.

This is a PURE refactor: NO behaviour change, NO on-disk `git mv`, NO folder VALUE
change, NO user-facing surface change (the CLI is already `task:`/`brief:`). The
acceptance gate staying green IS the proof nothing moved. The Phase-0 guard test
(`work-layout-guard.test.ts`) and the `work-layout` unit test must stay green (update
the unit test's expected key set to the new keys; the VALUES it asserts are
unchanged).

## Acceptance criteria

- [ ] `WORK_FOLDER_NAME` keys use the new vocabulary (`tasks-backlog`, `tasks-todo`,
      `briefs-proposed`, `briefs-ready`, `briefs-tasked`); every VALUE string is
      byte-identical to before (no folder moved).
- [ ] No `'pre-backlog'` / `'pre-spec'` / `'spec-sliced'` symbolic KEY, and no
      `'spec'`/`'backlog'`-as-a-folder-key, remains in `src/` (they are renamed); the
      slice/spec-named folder unions + types are renamed to task/brief vocabulary and
      every consumer updated.
- [ ] `terminalMainPaths` (item-lock.ts) reads `workItemRel('briefs-tasked', …)`
      (not `'spec-sliced'`), matching its docstring.
- [ ] NO behaviour change: `pnpm -r build && pnpm -r test && pnpm format:check` is
      green; no test edited for behaviour (only for the renamed symbols/keys).
- [ ] The Phase-0 guard test still passes; the `work-layout` unit test asserts the
      new key set with unchanged values.

## Blocked by

- None — can start immediately. The taxonomy migration (all six tasks) has landed.

## Prompt

> Build the internal-vocabulary cleanup the taxonomy migration deferred: rename the
> stale `work-layout` symbolic KEYS and the slice/spec-named folder-union
> identifiers to the new task/brief vocabulary, WITHOUT moving any on-disk folder or
> changing any behaviour.
>
> FIRST, check against current reality: confirm `work-layout`'s `WORK_FOLDER_NAME`
> still has keys `pre-backlog`/`backlog`/`pre-spec`/`spec`/`spec-sliced` mapping to the
> new `tasks/…`/`briefs/…` VALUES, and that the folder unions `SLICE_*_FOLDERS` /
> `PRD_FOLDERS` (+ types `SliceFolder`/`PrdFolder`) still carry old vocabulary. If
> the keys were already renamed, route to needs-attention.
>
> Domain vocabulary: the SYMBOLIC KEY is the stable name call sites use; the VALUE
> is the on-disk folder. The migration flipped the VALUES (`backlog → 'tasks/todo'`)
> but left some KEYS on the old words. This task flips only the KEYS (and the
> union/type names) to read in the new vocabulary; the VALUES (and therefore the
> on-disk layout) are untouched. The folder-as-status invariant and every path
> resolve byte-identically; the gate staying green proves it.
>
> Where to look: `work-layout.ts` (the `WORK_FOLDER_NAME` keys + the union arrays +
> types + docstrings), then every consumer of the renamed symbols (`prompt.ts`,
> `spec-complete.ts`, `close-job.ts`, `ledger-lint.ts`, `integration-core.ts`,
> `item-lock.ts` `terminalMainPaths`, `index.ts` re-exports) and the tests
> (`work-layout.test.ts` expected key set; any test importing the renamed
> unions/types). Use the type-checker as your guide: rename a key/type and `tsc`
> lights up every site to fix.
>
> "Done" means: the keys + union/type names read in task/brief vocabulary, no
> on-disk folder moved, every VALUE is byte-identical, the guard + unit tests pass,
> and `pnpm -r build && pnpm -r test && pnpm format:check` is green. Run `pnpm
> format` to fix formatting. RECORD any non-obvious in-scope naming choice (e.g. the
> exact new union name) per `ADR-FORMAT.md` (most will be a one-line `## Decisions`
> note, not an ADR).
