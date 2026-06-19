---
title: Phase 0: a single work-layout module owns every work/ path, folder union, and the item-scan predicate (no rename, no behaviour change)
slug: work-layout-module-centralises-all-work-paths
prd: folder-taxonomy-reorg-and-rename
humanOnly: true
blockedBy: []
covers: [4, 5, 11]
---

## What to build

The de-risking checkpoint of the taxonomy migration: introduce ONE `work-layout`
module that becomes the SOLE source of every `work/...` path string, every
folder-name union type, and every folder-name array in the package. Route ALL
current raw literals through it WITHOUT renaming anything and WITHOUT changing any
behaviour. After this slice, the later rename slices are a one-module value flip
rather than a ~150-file find-replace (which would also collide `slice` with
`Array/String.prototype.slice`).

Concretely, `work-layout` owns:

- The **(umbrella, lifecycle) → repo-relative path** mapping for every work
  folder. Today's umbrella is flat (there is no `notes/`/`tasks/`/`briefs/`
  nesting yet), so the module's CURRENT values are the EXACT names live today:
  `pre-backlog`, `backlog`, `done`, `dropped`, `pre-prd`, `prd`, `prd-sliced`,
  `observations`, `ideas`, `findings`, `questions`, `protocol` (+ the stray
  `in-progress` still referenced by some readers). Names stay byte-identical to
  today; only the SOURCE of the string moves into this module.
- The **folder-name unions and arrays** that are currently scattered: e.g.
  `SliceFolder` (`prompt.ts`), `WORK_FOLDERS` (`ledger-write.ts`), `PRD_FOLDERS`
  (`close-job.ts`), `LEDGER_STATUS_FOLDERS` (`ledger-lint.ts` /
  `integration-core.ts`), `SLICE_FOLDERS` (`prd-complete.ts`). They re-export
  from / are derived in `work-layout` so there is one definition.
- The **item-scan predicate** (which `*.md` files under a work folder count as
  work items), defined once here so no reader re-implements it.
- The **prefix-slice helpers**, anywhere code does `path.slice('work/backlog/'.length)`
  or `'work/pre-backlog/'.length` to recover a filename, it goes through a
  `work-layout` helper instead of a hand-written literal length.

Then sweep `src/` so every `join(cwd, 'work', ...)`, every raw `'work/<folder>'`
string, every prefix-slice, and every folder-union/array reads from `work-layout`.
This is a PURE refactor: the acceptance gate (`pnpm -r build && pnpm -r test &&
pnpm format:check`) staying green IS the proof that nothing changed. No on-disk
`git mv`, no protocol-doc edit, no vocabulary change in this slice.

The module's surface should anticipate the rename (the later slices flip VALUES
here, not call sites) but must NOT introduce the new names yet, this slice is the
"de-string everything, change nothing" checkpoint and is independently valuable
even if the rename never ships.

## Acceptance criteria

- [ ] A `work-layout` module exists and is the single definition of every work/
      folder path, folder-name union, and folder-name array used in `src/`.
- [ ] Every `join(cwd, 'work', ...)` call, raw `'work/<folder>'` literal, and
      prefix-slice in `src/` resolves through `work-layout` (the guard test in the
      sibling slice enforces this; this slice must leave that guard passable).
- [ ] The item-scan predicate is defined ONCE in `work-layout`; no reader
      re-derives it.
- [ ] Folder NAMES are byte-identical to today (no rename): `pre-backlog`,
      `backlog`, `done`, `dropped`, `pre-prd`, `prd`, `prd-sliced`,
      `observations`, `ideas`, `findings`, `questions`, `protocol`.
- [ ] NO behaviour change: `pnpm -r build && pnpm -r test && pnpm format:check`
      is green with no test edited for behaviour (tests may be edited only where
      they reference an internal symbol that moved into `work-layout`).
- [ ] Tests cover the new behaviour (mirror the repo's existing test style), at
      minimum a focused unit test of the `work-layout` path/predicate API.

## Blocked by

- None, can start immediately. This is the migration's first slice and the
  de-risking checkpoint.

## Prompt

> Build Phase 0 of the `folder-taxonomy-reorg-and-rename` PRD: centralise EVERY
> `work/...` path behind one new `work-layout` module, with ZERO behaviour change
> and ZERO rename. This is the de-risking spine, all the risk of the later
> migration lives here, and it is gate-verifiable.
>
> FIRST, check this slice against current reality (it is a launch snapshot and may
> have DRIFTED): confirm there is still no `work-layout` module, and that work-path
> literals are still scattered across `src/` (`join(cwd, 'work', ...)` calls, raw
> `'work/<folder>'` strings, prefix-slices like `'work/pre-backlog/'.length`, and
> the folder unions `SliceFolder` / `WORK_FOLDERS` / `PRD_FOLDERS` /
> `LEDGER_STATUS_FOLDERS` / `SLICE_FOLDERS`). If the module already exists or the
> centralisation already happened, route this slice to needs-attention with the
> discrepancy rather than rebuilding.
>
> Domain vocabulary: a `work/` tree is a set of governance folders; "status is the
> folder" is the crown-jewel invariant (a CAS `git mv` between durable folders is
> the conflict-safe state machine). The live folder names today are `pre-backlog`
> (slice staging) / `backlog` (the agent pool) / `done` / `dropped` (generic
> terminal), and `pre-prd` (PRD staging) / `prd` (auto-slice pool) / `prd-sliced`
> (sliced, resting), plus the capture buckets `observations` / `ideas` /
> `findings`, `questions` (top-level), and `protocol`. The transient states
> (`in-progress`/`needs-attention`/`slicing`/`advancing`) are NOT folders, they
> are per-item lock-ref state (see `item-lock.ts`); a stray `in-progress` literal
> may still exist in some readers and should route through `work-layout` like any
> other.
>
> Where to look: every `.ts` in `packages/agent-runner/src` that mentions `work/`
> (about 70 files). The folder unions/arrays are in `prompt.ts` (`SliceFolder`),
> `ledger-write.ts` (`WORK_FOLDERS`), `close-job.ts` (`PRD_FOLDERS`),
> `ledger-lint.ts` + `integration-core.ts` (`LEDGER_STATUS_FOLDERS`),
> `prd-complete.ts` (`SLICE_FOLDERS`). The item-scan filter and prefix-slices live
> in readers like `slicer-review-loop.ts`, `ledger-read.ts`, `scan.ts`,
> `slicing.ts`, `intake.ts`, `placement.ts`.
>
> "Done" means: a `work-layout` module is the sole source of every work-path
> string, folder union/array, and the item-scan predicate; all call sites route
> through it; NAMES are byte-identical to today; and `pnpm -r build && pnpm -r test
> && pnpm format:check` is green with no behavioural test change. Do NOT rename
> anything, do NOT `git mv` any on-disk file, do NOT touch the protocol docs, those
> are later slices that flip the VALUES in this module.
>
> Design `work-layout`'s API so the later rename is a value-only change here (the
> call sites should never need re-touching to rename a folder). If you make a
> non-obvious in-scope API-shape decision, record it (a `## Decisions` note, or an
> ADR if it meets the ADR gate in `ADR-FORMAT.md`).
