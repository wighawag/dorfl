---
title: Phase 1: regroup the notes regime under notes/ and rename the task board (pre-backlog->tasks/backlog, backlog->tasks/todo, done->tasks/done)
slug: regroup-notes-and-task-board-rename
prd: folder-taxonomy-reorg-and-rename
humanOnly: true
blockedBy: [work-layout-module-centralises-all-work-paths]
covers: [6, 8, 9]
---

## What to build

The first Phase-1 flip behind the now-centralised `work-layout` module: regroup the
CAPTURE regime under a `notes/` umbrella and rename the BUILD board into the
`tasks/` Kanban umbrella, by changing the VALUES in `work-layout` and `git mv`-ing
the on-disk files. No behaviour change beyond the new paths; the folder-as-status
invariant is preserved (durable positions only, CAS `git mv` unchanged).

Mapping for THIS slice:

- `observations/`  → `notes/observations/`
- `ideas/`         → `notes/ideas/`
- `findings/`      → `notes/findings/`
- `pre-backlog/`   → `tasks/backlog/`   (slice STAGING takes the freed `backlog` name)
- `backlog/`       → `tasks/todo/`      (the agent POOL keeps being the pool, new name)
- `done/`          → `tasks/done/`

`questions/` STAYS top-level (NOT folded under `notes/`). `protocol/` is untouched
here (the protocol-doc mirror is its own later slice). The brief regime
(`pre-prd`/`prd`/`prd-sliced`) and the per-regime terminals are NOT in this slice
(they are the sibling brief-rename + dropped-migration slice).

Two on-disk realities to handle cleanly:

- There is NO `pre-backlog/` or `pre-prd/` directory on disk today (they are
  created lazily); the rename is therefore a `work-layout` value change plus a
  `git mv` of whatever live files exist (today `backlog/` and `done/` have content,
  the capture buckets have content).
- There is a stray `work/in-progress/<slug>.md` file on disk even though
  `in-progress` is no longer a durable folder (transient status is lock-ref state).
  Re-home it to its correct DURABLE position under the new `tasks/` umbrella (it is
  a pool/backlog item by nature, it carries no lock, so it belongs in the agent
  pool `tasks/todo/`), WITHOUT reintroducing any transient folder. Do not create a
  `tasks/in-progress/`.

The `git mv` is on-disk content relocation that the RUNNER/human owns at
integration, but the work-tree state THIS slice produces (the moved files + the
flipped constants) must be internally consistent and green.

## Acceptance criteria

- [ ] `work-layout` resolves the notes regime to `notes/{observations,ideas,findings}`
      and the task board to `tasks/backlog` (staging) / `tasks/todo` (pool) /
      `tasks/done`.
- [ ] The on-disk files are relocated to the new paths (the capture buckets, the
      pool, done, and the staging mapping) consistent with the new constants.
- [ ] `questions/` remains top-level; `protocol/` is untouched by this slice.
- [ ] The stray `in-progress/<slug>.md` is re-homed to its durable position under
      `tasks/` (the pool `tasks/todo/`) with NO transient folder reintroduced.
- [ ] The folder-as-status invariant is intact: durable positions only, CAS
      `git mv` transitions still conflict-safe across the nested folders.
- [ ] Tests cover the new paths resolving and the CAS transitions staying
      conflict-safe; the Phase-0 guard test still passes (literals still only in
      `work-layout`).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- `work-layout-module-centralises-all-work-paths`, this slice flips VALUES in
  that module; it must exist and own every path first.

## Prompt

> Build the notes-regroup + task-board-rename flip of the
> `folder-taxonomy-reorg-and-rename` PRD: regroup the capture regime under `notes/`
> and rename the build board into `tasks/` (`pre-backlog -> tasks/backlog`,
> `backlog -> tasks/todo`, `done -> tasks/done`; `observations/ideas/findings ->
> notes/{...}`), by changing the VALUES in the `work-layout` module and `git mv`-ing
> the on-disk files. NO behaviour change beyond the paths.
>
> FIRST, check this slice against current reality: confirm `work-layout` exists and
> is the sole source of work paths (the Phase-0 slice landed), and that the live
> folders are still `backlog`(pool)/`done`/capture buckets with `pre-backlog` as
> lazily-created staging. If the layout already moved, route to needs-attention.
>
> Domain vocabulary: `tasks/` is a Kanban board with DURABLE positions only,
> `backlog` (staging, was `pre-backlog`) -> `todo` (the agent pool, was `backlog`)
> -> `done` -> `cancelled` (the per-regime terminal, added by the SIBLING
> brief/dropped slice, NOT here). The transient states
> (`in-progress`/`needs-attention`/`slicing`/`advancing`) are NOT folders, they are
> per-item lock-ref state (`item-lock.ts`); do NOT reintroduce a transient folder.
> `questions/` stays TOP-LEVEL (do not fold it under `notes/`). `protocol/` is a
> later slice, leave it.
>
> Where to look: the `work-layout` module (flip its values for the notes + task
> folders), and the on-disk `work/` tree (`git mv` the live files: the capture
> buckets, the pool, done, and a stray `work/in-progress/<slug>.md` that must be
> re-homed to its durable pool position `tasks/todo/`, it carries no lock, so it
> belongs in the pool). The CAS `git mv` transition machinery is in `ledger-write.ts`
> / `integration-core.ts`; the divergent-base guard backstops placement.
>
> "Done" means: the new paths resolve through `work-layout`, the on-disk files are
> at their new homes, `questions/` is still top-level, no transient folder exists,
> the CAS transitions stay conflict-safe, the Phase-0 guard still passes, and the
> full acceptance gate is green. Do NOT touch the brief regime, the per-regime
> terminals, the vocabulary/identity cutover, or the protocol docs, those are
> sibling slices.
>
> RECORD any non-obvious in-scope decision (e.g. exactly where the stray
> `in-progress` file lands) per `ADR-FORMAT.md`.
