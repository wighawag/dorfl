---
title: Phase 1: rename the brief regime (pre-prd->briefs/proposed, prd->briefs/ready, prd-sliced->briefs/tasked) + per-regime terminals (tasks/cancelled, briefs/dropped) + migrate top-level work/dropped
slug: brief-regime-rename-and-dropped-migration
spec: folder-taxonomy-reorg-and-rename
humanOnly: true
blockedBy: [work-layout-module-centralises-all-work-paths, regroup-notes-and-task-board-rename]
covers: [1, 7, 10]
---

## What to build

The brief-side flip plus the per-regime terminal correctness fix, behind the
centralised `work-layout` module (value change + `git mv`). Two coupled pieces:

**1. Brief regime rename** (its own lifecycle, NOT a mirror of `tasks/`). The split
(staging gate -> admitted pool) is KEPT, deliberately; the names express
staging-gate-vs-admitted, NOT "unfinished-vs-finished" (a brief is created when it
is ready to slice, so `draft` was rejected in favour of `proposed`):

- `pre-prd/`     -> `briefs/proposed/`  (the STAGING gate: a brief not yet admitted to the auto-slice pool)
- `prd/`         -> `briefs/ready/`     (the auto-slice POOL: ready to slice)
- `prd-sliced/`  -> `briefs/tasked/`    (decomposed, resting, the `done/` analogue)

**2. Per-regime won't-proceed terminals + migrate the shared top-level dropped.**
This is a CORRECTNESS fix, not cosmetics. A slice, a PRD, and an observation can
share a slug, and the shipped TOP-LEVEL `work/dropped/` keys by BARE slug, so a
dropped task and a dropped brief sharing a slug COLLIDE on `dropped/<slug>.md`
(today `item-lock.ts`'s `terminalMainPaths` routes a dropped slice, PRD, AND
observation all to one `work/dropped/`). Give each regime its OWN terminal with the
DELIBERATELY DIFFERENT word per regime:

- `tasks/cancelled/`   (double-l, matching existing protocol prose)
- `briefs/dropped/`

A dropped OBSERVATION needs NO terminal folder, notes leave by deletion.

Then MIGRATE the existing top-level `work/dropped/` contents into the right regime
terminal, sorting each by what it IS (its type, established below):

- `retire-transient-folders-and-drop-rebase.md`, has `prd: ledger-status-per-item-lock-refs`
  and slice-shaped `blockedBy` → it is a TASK (slice) → `tasks/cancelled/`.
- `branch-carries-code-not-ledger-status-main-owns-status.md`, full PRD body
  (Problem/Solution/User Stories), `reason: superseded`, no `prd:` parent; git
  history shows it was renamed `work/prd/ -> work/dropped/` ("retire superseded
  PRD") → it is a BRIEF (PRD) → `briefs/dropped/`.

Update `terminalMainPaths` (and any other reader that derived a bare-slug
`work/dropped/<slug>.md`) so each TYPE keys onto its own namespaced terminal
(`task` → `tasks/cancelled/`, `brief` → `briefs/dropped/`), removing the
cross-regime collision. (The disposition value that ROUTES a drop, currently
`dropped` in `sidecar.ts`, keeps its meaning; only the resolved PATH becomes
regime-namespaced.)

NOTE on vocabulary: this slice renames FOLDERS and routing PATHS only. The
`slice->task` / `prd->brief` IDENTITY + CLI + frontmatter cutover is the SIBLING
slice; here keep the existing identity prefixes (`slice`/`prd`) untouched, just
land the brief folders + the namespaced terminals so the cutover slice has them to
build on.

> FORWARD-POINTER (planted by the conductor, drive-backlog). Like the sibling
> notes/task-board rename (PR #177), this slice RENAMES ledger folders the runner
> reads. The runner's `complete` now survives that (PRs #175/#176): when this
> slice's own record is at none of the pre-rename ledger folders, it detects the
> record in a `done`-LEAF folder and integrates the agent's tree as-is. So, as the
> FINAL step of your work, move THIS slice's own record to its terminal
> done-position under the CURRENT (already-renamed) layout — i.e. to
> `work/tasks/done/<this-slug>.md` (the `tasks/` board landed in PR #177) — and
> `git add -A`. Do NOT leave your own record in the pool (`tasks/todo/`) or it will
> be treated as unfinished and refused. (You are NOT renaming `tasks/`; you are
> ADDING `tasks/cancelled/` under it + the `briefs/` regime. Your own record simply
> completes into the existing `tasks/done/`.)
>
> KNOWN one-file artifact (FYI, the conductor handles it at review, you need do
> nothing): the Gate-2 review writes a `review-nits-<slug>.md` via the runner
> binary's still-pre-rename `work-layout`, so it may land in a pre-rename folder.
> The conductor re-homes that single file at Gate-3 (see
> `work/notes/observations/rename-slice-gate-writes-review-nits-to-pre-rename-folder-2026-06-19.md`).

## Acceptance criteria

- [ ] `work-layout` resolves the brief regime to `briefs/proposed` (staging) /
      `briefs/ready` (pool) / `briefs/tasked` (resting), and the two terminals to
      `tasks/cancelled/` and `briefs/dropped/`.
- [ ] The on-disk brief files are relocated to the new paths.
- [ ] `terminalMainPaths` (and every reader that derived a bare-slug
      `work/dropped/<slug>.md`) keys each type onto its namespaced terminal; no
      reader resolves a bare-slug `work/dropped/` path.
- [ ] The two existing `work/dropped/` files are migrated:
      `retire-transient-folders-and-drop-rebase.md` -> `tasks/cancelled/`;
      `branch-carries-code-not-ledger-status-main-owns-status.md` -> `briefs/dropped/`.
- [ ] A dropped observation needs no terminal folder (notes leave by deletion),
      no observation terminal is introduced.
- [ ] Tests assert the per-regime terminals resolve, a task-drop and a brief-drop
      sharing a slug NO LONGER collide, and the Phase-0 guard still passes.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- `work-layout-module-centralises-all-work-paths`, flips values in that module.
- `regroup-notes-and-task-board-rename`, serialised: both touch `work-layout`
  constants and the ledger terminal code; the `tasks/` umbrella must exist before
  `tasks/cancelled/` is added under it.

## Prompt

> Build the brief-regime rename + per-regime terminal correctness fix of the
> `folder-taxonomy-reorg-and-rename` PRD: `pre-prd -> briefs/proposed`, `prd ->
> briefs/ready`, `prd-sliced -> briefs/tasked`; add the per-regime won't-proceed
> terminals `tasks/cancelled/` (double-l) and `briefs/dropped/`; and MIGRATE the
> existing top-level `work/dropped/` contents into the right regime terminal. All
> behind the centralised `work-layout` module (value change + `git mv`).
>
> FIRST, check this slice against current reality: confirm `work-layout` exists, the
> `tasks/` umbrella landed (sibling slice `regroup-notes-and-task-board-rename` is in
> `done/`), and the live brief folders are still `prd`(pool)/`prd-sliced`/`pre-prd`.
> If the layout already moved, route to needs-attention.
>
> WHY the terminal split is load-bearing (not cosmetic): a slice, a PRD, and an
> observation can share a slug, and the shipped TOP-LEVEL `work/dropped/` keys by
> BARE slug, so a dropped task and a dropped brief sharing a slug COLLIDE on
> `dropped/<slug>.md`. `item-lock.ts`'s `terminalMainPaths` today routes all three
> types to one `work/dropped/`. The umbrellas namespace the collision away:
> `task -> tasks/cancelled/`, `brief -> briefs/dropped/`; a dropped observation
> needs no terminal (notes leave by deletion).
>
> The two files to migrate, with their type already determined (do not re-litigate):
> `retire-transient-folders-and-drop-rebase.md` is a TASK (it carries
> `prd: ledger-status-per-item-lock-refs` + slice `blockedBy`) -> `tasks/cancelled/`;
> `branch-carries-code-not-ledger-status-main-owns-status.md` is a BRIEF (a full PRD
> body, `reason: superseded`, git history `work/prd/ -> work/dropped/`) ->
> `briefs/dropped/`.
>
> Where to look: the `work-layout` module (flip the brief values, add the two
> terminals); `item-lock.ts` `terminalMainPaths` (route each type to its namespaced
> terminal); `sidecar.ts` (the `dropped` DISPOSITION keeps its meaning, only the
> resolved path becomes regime-namespaced); any other reader deriving a bare-slug
> `work/dropped/<slug>.md`. The on-disk `git mv` relocates the brief folders + the
> two dropped files.
>
> SCOPE FENCE: rename FOLDERS and routing PATHS only. Do NOT do the
> `slice->task`/`prd->brief` identity/CLI/frontmatter cutover here, that is the
> sibling slice `slice-task-prd-brief-vocabulary-hard-cutover`; keep the existing
> `slice`/`prd` identity prefixes untouched so that slice has these folders to build
> on.
>
> "Done" means: the brief folders resolve at their new paths, the two terminals
> exist and are per-regime, the two dropped files are migrated to the right terminal,
> no reader resolves a bare-slug `work/dropped/` path, a task-drop and brief-drop
> sharing a slug no longer collide, the Phase-0 guard still passes, and the full
> acceptance gate is green. RECORD any non-obvious in-scope decision per
> `ADR-FORMAT.md`.
