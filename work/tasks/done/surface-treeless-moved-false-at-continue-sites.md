---
title: 'surface-treeless-moved-false-at-continue-sites: inspect the {moved, reasonNotMoved} result of the tree-less needs-attention surface at the after-commit continue-sites so a contention-exhausted or no-arbiter moved:false is surfaced honestly instead of being reported as a clean needs-attention while the item is silently left in-progress on main'
slug: surface-treeless-moved-false-at-continue-sites
blockedBy: []
covers: []
---

> Self-contained ROBUSTNESS / CORRECTNESS slice. It derives from NO SPEC (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth.
>
> Source signal: `work/observations/review-nits-treeless-surface-for-after-commit-push-failure-2026-06-14.md` (nit 2). The after-commit continue-sites IGNORE the `{moved}` result of the tree-less needs-attention surface, so a contention-exhausted `moved:false` (5 attempts) on a busy arbiter, or a no-arbiter `moved:false`, can leave the item silently in-progress on main while the run reports needs-attention. This was flagged as PRE-EXISTING (the old cwd-bound `applyNeedsAttentionTransition` callsites at these same spots also ignored the result), so it is a FIX, not a regression repair introduced by the tree-less slice.

## What to build

Make the after-commit continue-sites inspect the `{moved, reasonNotMoved}` return of `applyTreelessNeedsAttentionTransition` and surface the un-moved case HONESTLY, instead of reporting a clean needs-attention as if the surface landed.

Today (verify against current code before building):

- `applyTreelessNeedsAttentionTransition` (`src/ledger-write.ts` ~L346/L706) returns `ApplyTreelessNeedsAttentionTransitionResult` = `Promise<SurfaceToNeedsAttentionResult>` = `{moved: boolean; commitMessage?; reasonNotMoved?}` (`src/needs-attention.ts` ~L239-246). `surfaceToNeedsAttention` returns `{moved: false, reasonNotMoved}` for the EXPECTED cases: no `--arbiter` (~L698-705), no such remote (~L711-715), the item not on the arbiter (~L745-747), and CONTENTION EXHAUSTED after its retry cap (~L815-817). It throws ONLY for unexpected git plumbing failures.
- The after-commit continue-sites all `await` this surface and DISCARD the result, then report a clean needs-attention regardless:
  - `src/do.ts` ~L747 (`continueRebaseConflict`) and ~L779 (`continuePushFailure`): `await ledgerWrite.applyTreelessNeedsAttentionTransition({...})` then `return {exitCode: 1, outcome: 'needs-attention', ...}` with the result unchecked.
  - `src/run.ts` ~L543 (`continueRebaseConflict`) and ~L571 (`continuePushFailure`): same pattern, then `return {...base, status: 'needs-attention', detail: reason}` (after an `updateJobRecord(tree.dir, {state: 'needs-attention', reason})` that records the LOCAL state regardless of the arbiter move).
  - `src/start.ts` `routeContinueConflict` (~L731) and `routeContinuePushFailure` (~L772): both `await` the surface and return `void` (the result is not even propagated to their callers, e.g. `continuePushFailureResult` ~L344).

So on a `moved:false` (contention-exhausted or no-arbiter) the run reports `outcome/status: 'needs-attention'` though the ledger move NEVER landed on main, leaving the item silently in-progress on the arbiter, lost to the next scan.

What to build: at each of these continue-sites, INSPECT the `{moved, reasonNotMoved}` return. When `moved:false`, do NOT report a clean needs-attention as if the surface landed. Instead surface the un-moved case honestly so it is not silently lost: a DISTINCT message that says the surface did NOT reach main and the item is still in-progress on the arbiter (carrying `reasonNotMoved`), via a distinct outcome/status (or detail) the caller and the human can act on. The exact recovery shape is a `## Decisions` choice (a distinct outcome/status vs a clear-warning-on-the-same-status vs a retry), but the load-bearing requirement is: a `moved:false` must NOT be indistinguishable from a successful `moved:true` needs-attention surface.

- `do.ts`/`run.ts`: branch on the returned `{moved}` and produce a distinct, honest result for `moved:false` (carrying `reasonNotMoved`), distinct from the `moved:true` clean needs-attention.
- `start.ts`: the `routeContinue*` helpers must PROPAGATE the `{moved, reasonNotMoved}` up to their callers (they currently return `void`); the caller (`continuePushFailureResult` and the conflict path) then produces the honest un-moved result instead of a clean needs-attention.

Keep the `moved:true` path byte-for-byte as today (the common, successful case is unchanged). Only the `moved:false` branch is new.

NOTE on which `moved:false` cases are live here (verify, then scope the message accordingly): these continue-sites run AFTER the item was claimed/requeued onto the arbiter, so the arbiter is always present (start.ts just claimed the item onto it; the do.ts/run.ts continue-sites are autonomous paths that always carry an arbiter). So the no-arbiter / no-such-remote `moved:false` exits are effectively unreachable HERE; the live `moved:false` case is CONTENTION-EXHAUSTED (the busy-arbiter retry cap), plus the item-not-on-arbiter corruption case. Do NOT over-engineer a no-arbiter local-only branch that cannot fire at these sites; the honest result should read as "the surface lost the CAS race against a busy arbiter; the item is still in-progress on main, retry/resolve" (carrying `reasonNotMoved`, which already distinguishes the underlying cause).

## Acceptance criteria

- [ ] Each after-commit continue-site (`do.ts` continueRebaseConflict + continuePushFailure; `run.ts` continueRebaseConflict + continuePushFailure; `start.ts` routeContinueConflict + routeContinuePushFailure) INSPECTS the `{moved, reasonNotMoved}` return of `applyTreelessNeedsAttentionTransition`.
- [ ] On `moved:false` (contention-exhausted or no-arbiter), the site does NOT report a clean needs-attention indistinguishable from a successful surface: it produces a DISTINCT, honest result that says the surface did not reach main and the item is still in-progress on the arbiter, carrying `reasonNotMoved`.
- [ ] `start.ts`'s `routeContinueConflict`/`routeContinuePushFailure` PROPAGATE the `{moved, reasonNotMoved}` to their callers (they no longer swallow it as `void`); the caller produces the honest un-moved result.
- [ ] The `moved:true` path is byte-for-byte unchanged across all three files (the common successful needs-attention surface still reports a clean needs-attention).
- [ ] Tests cover BOTH branches at the continue-sites: a `moved:true` surface still reports a clean needs-attention; a `moved:false` surface (stub the seam to return `{moved:false, reasonNotMoved}`, e.g. no-arbiter or contention-exhausted) produces the distinct honest un-moved result, NOT a clean needs-attention. Mirror the repo's existing do/run/start test style and inject the seam (do not force real contention).
- [ ] Tests use their OWN throwaway temp fixtures: NO shared/global location is written (no real home/config dir, no user-level git config), and any per-run scratch points at a temp dir.
- [ ] A `## Decisions` block records the chosen un-moved surface shape (a distinct outcome/status vs a warning on the same status vs a retry) and why; and that the `moved:true` path is unchanged; and that this is a pre-existing fix (the cwd-bound callsites had the same gap), not a regression repair.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green (note: `format:check` is ROOT-only, NOT `-r`).

## Blocked by

- None; can start immediately. Independent of the run-concurrency / fresh-worktree-gate slices and of the propose-pr-intent guard slice (different files / seams).

## Decisions (to record while building)

- **Un-moved surface shape.** Record the chosen honest-failure shape for `moved:false`: a distinct outcome/status (preferred, so a caller/human can branch on it) vs a clear warning on the existing needs-attention status vs an automatic retry. Lean toward a distinct, honest result that carries `reasonNotMoved` and states the item is still in-progress on the arbiter, since the whole point is that `moved:false` must be DISTINGUISHABLE from a successful surface.
- **Which `moved:false` is live here.** Record that at these after-commit continue-sites the arbiter is always present (the item was just claimed/requeued onto it), so the live `moved:false` is contention-exhausted (busy-arbiter CAS race), not a no-arbiter local-only outcome; the honest message is scoped to that (carrying `reasonNotMoved` for the underlying cause).
- **moved:true unchanged.** Record that the common successful surface path is byte-for-byte unchanged; only the `moved:false` branch is added.
- **Pre-existing fix.** Record that this is a fix for a PRE-EXISTING gap (the old cwd-bound `applyNeedsAttentionTransition` callsites at these spots ignored their result too), surfaced by the tree-less slice's genuine `moved:false` contention-exhausted exit, NOT a regression introduced by that slice.

## Prompt

> Make the after-commit continue-sites inspect the `{moved, reasonNotMoved}` result of the tree-less needs-attention surface and surface a `moved:false` HONESTLY, instead of reporting a clean needs-attention while the item is silently left in-progress on main. `applyTreelessNeedsAttentionTransition` (`src/ledger-write.ts` ~L346/L706) returns `{moved, commitMessage?, reasonNotMoved?}` (`SurfaceToNeedsAttentionResult`, `src/needs-attention.ts` ~L239-246); `surfaceToNeedsAttention` returns `{moved:false, reasonNotMoved}` for no-arbiter, no-such-remote, item-not-on-arbiter, and CONTENTION-EXHAUSTED (its retry cap), throwing only on unexpected git plumbing. Today every after-commit continue-site `await`s it and DISCARDS the result, then reports a clean needs-attention.
>
> BUILD: at each continue-site, inspect `{moved, reasonNotMoved}` and on `moved:false` produce a DISTINCT honest result (the surface did NOT reach main; the item is still in-progress on the arbiter; carry `reasonNotMoved`), NOT a clean needs-attention. Sites: `src/do.ts` ~L747 (`continueRebaseConflict`) + ~L779 (`continuePushFailure`); `src/run.ts` ~L543 + ~L571 (note the `updateJobRecord(... 'needs-attention' ...)` there records LOCAL state regardless of the arbiter move; the honest result must not contradict that confusingly); `src/start.ts` `routeContinueConflict` ~L731 + `routeContinuePushFailure` ~L772 (these return `void` today: change them to PROPAGATE `{moved, reasonNotMoved}` to their callers, e.g. `continuePushFailureResult` ~L344, which then produces the honest un-moved result). Keep the `moved:true` path byte-for-byte unchanged.
>
> RECORD a `## Decisions` block: the chosen un-moved surface shape (distinct outcome/status preferred, so callers/humans can branch; vs warning-on-same-status vs retry) and why; that `moved:true` is unchanged; that this is a PRE-EXISTING fix (the old cwd-bound `applyNeedsAttentionTransition` callsites ignored their result too), not a regression repair.
>
> READ FIRST (and DRIFT-CHECK every claim against the actual code): `src/needs-attention.ts` (`SurfaceToNeedsAttentionResult` ~L239-246 + `surfaceToNeedsAttention` ~L692 onward, the `moved:false` exits ~L698/L711/L745/L815); `src/ledger-write.ts` (`applyTreelessNeedsAttentionTransition` ~L346/L706 + `ApplyTreelessNeedsAttentionTransitionResult` ~L231); `src/do.ts` (~L742-792 the two continue-sites + their `return` shapes); `src/run.ts` (~L537-583 the two continue-sites + `updateJobRecord` + the `ItemResult`/`ItemStatus` ~L148 for the honest status choice); `src/start.ts` (`routeContinueConflict` ~L725, `routeContinuePushFailure` ~L757, `continuePushFailureResult` ~L344 + the call sites ~L293/L436/L483). DRIFT-CHECK: confirm the continue-sites still DISCARD the result; if a prior slice already inspects `{moved}` here, route THIS slice to needs-attention with that discrepancy.
>
> SCOPE FENCE: do NOT change the `moved:true` successful-surface path; do NOT touch the cwd-bound `applyNeedsAttentionTransition` callsites (the uncommitted-wip surfaces, e.g. `performDoRemote`'s ~L1726/L1758, are a DIFFERENT path, out of scope); do NOT change the tree-less surface primitive itself (only its callers' result-handling); do NOT introduce a real-contention test (inject the seam to return `{moved:false}`). "Done" = every after-commit continue-site inspects `{moved}`, a `moved:false` produces a distinct honest un-moved result (item still in-progress on the arbiter, carrying `reasonNotMoved`), `start.ts` propagates the result to its callers, the `moved:true` path is unchanged, tests cover both branches with no shared-global write, the Decisions block is recorded, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> FIRST, check this slice against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `done/` and current `src/do.ts`/`src/run.ts`/`src/start.ts`/`src/needs-attention.ts`? If the continue-sites already inspect `{moved}`, do NOT build on the stale premise; route the slice to `needs-attention/` with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").

---

### Claiming this slice

```sh
dorfl claim surface-treeless-moved-false-at-continue-sites --arbiter origin
git fetch origin && git switch -c work/surface-treeless-moved-false-at-continue-sites origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/surface-treeless-moved-false-at-continue-sites.md work/done/surface-treeless-moved-false-at-continue-sites.md
```
