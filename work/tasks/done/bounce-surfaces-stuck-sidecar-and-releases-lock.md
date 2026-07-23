---
title: 'Add the tree-less surface primitive additively (PR-1, keep `bounceToStuckLock` alive)'
slug: bounce-surfaces-stuck-sidecar-and-releases-lock
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: []
covers: [1, 3]
---

## Scope of THIS task: PR-1, ADDITIVE ONLY (re-scoped 2026-07-13)

A first build attempt correctly STOPPED and surfaced a load-bearing scope contradiction: the previous version of this file demanded the FULL cutover in its acceptance criteria (no `stuck` lock remains; migrate the pinned exit-code tests) WHILE ALSO instructing an additive PR-1 that KEEPS `bounceToStuckLock` alive. Those two readings are mutually exclusive under one-task-per-PR. The maintainer's decision: **this task is PR-1 ONLY. Build the new surface primitive ADDITIVELY and prove it in isolation, changing NO existing bounce behaviour.** The atomic cutover (flip both seams, migrate the 137 `stuckLockOnArbiter` assertions, wire the recovery predicate, flip the exit codes) is the SEPARATE follow-up task `bounce-atomic-cutover-retire-stuck-lock` (blocked by this one).

Hard boundary for THIS task:
- **DO** add the new tree-less surface primitive `prepareTreelessSurfaceCommit` + the two new test helpers + focused new tests that exercise the primitive directly.
- **DO NOT** flip `applyNeedsAttentionTransition` (cwd-bound) or `applyTreelessNeedsAttentionTransition` (tree-less) to call it.
- **DO NOT** touch `bounceToStuckLock` / `markStuckItemLock`: it stays live and every existing bounce still marks the lock `stuck`.
- **DO NOT** migrate any existing `stuckLockOnArbiter(...).toBe(true)` assertion (there are 137 across 30 files: all owned by PR-2).
- **DO NOT** change any `agent-stopped` / `gate-failed` / etc. exit code (owned by PR-2).

Because PR-1 does not flip either seam, the cwd-on-`main` reachability question for the cwd-bound path (the specific gap the prior file left unresolved in A4) does NOT arise here: it is resolved in PR-2 where the cwd-bound flip actually happens. PR-1 proves ONLY the tree-less plumbing primitive, which needs NO working tree by construction.

## Answered design decisions carried into PR-1

**A1 (helpers only), add two house-style asserters, do NOT migrate call sites yet.** Add `sidecarSurfacedOnArbiterMain(repo, slug)` and `needsAnswersOnArbiterMain(repo, slug)` to `packages/dorfl/test/helpers/gitRepo.ts`, mirroring `stuckLockOnArbiter`'s shape and building on the existing `pathOnArbiterMain` / `existsOnArbiterMain` / `parseFrontmatter`. These are the observable PR-2 will migrate the 137 assertions to; PR-1 only ADDS them and uses them in its OWN new tests. The existing 137 `stuckLockOnArbiter` assertions stay untouched and green.

**A4 (tree-less primitive), `prepareTreelessSurfaceCommit` via git PLUMBING.** Build a NEW `prepareTreelessSurfaceCommit`, a 2-file SIBLING of the existing `prepareTreelessMoveCommit` in `needs-attention.ts`: pure git plumbing (`hash-object` / scratch-index `update-index` / `write-tree` / `commit-tree`, NO working tree) that in ONE commit (a) writes/appends the item's `work/questions/<type>-<slug>.md` sidecar and (b) sets `needsAnswers:true` on the item body (both read from `<arbiter>/main` blobs via `catBlob`). Run it through the EXISTING `runTreelessLedgerMove` CAS loop, then `releaseItemLock`. Surface-first / release-second ordering + crash-safety come FREE from `runTreelessLedgerMove` (lands on `main`, THEN releases in `finally`, `main`-authoritative). The pure content builders (`newSidecar` / `serialiseSidecar` / `appendQuestions` / the `setNeedsAnswersMarker` marker setter) are REUSED, not duplicated. (Rejected alternatives, unchanged: scratch-clone-per-bounce: slow + new failure surface; thread a writable `treelessCwd`: assumes a checkout that by definition does not exist.)

Note the cwd-bound persist path (`persistSurfacedQuestions` + `pushTreelessResult`) is NOT wired into any bounce seam in PR-1 either: the cwd-bound seam is flipped in PR-2, where the "how does the bounce cwd reach `main`" question is answered. PR-1's new tests drive `prepareTreelessSurfaceCommit` directly against a canned arbiter, with no seam flip.

## What to build

Add the tree-less surface primitive and prove it in isolation, WITHOUT changing any bounce behaviour:

1. `prepareTreelessSurfaceCommit` in `needs-attention.ts`: the 2-file (sidecar + body) git-plumbing sibling of `prepareTreelessMoveCommit`, reading current sidecar + body from `<arbiter>/main` blobs, producing ONE commit that appends/creates the `stuck`-kind sidecar (reason + any surfaced questions) AND sets `needsAnswers:true`. Reuse the shared pure content builders; do not duplicate them. The `stuck` SidecarKind already exists.
2. A thin harness that runs `prepareTreelessSurfaceCommit` through the EXISTING `runTreelessLedgerMove` CAS loop then `releaseItemLock`, so the surface-first/release-second ordering and `main`-authoritative crash-safety are inherited (NOT re-implemented). This harness is EXERCISED BY TESTS ONLY in PR-1; it is not yet called from either bounce seam.
3. The two new test helpers `sidecarSurfacedOnArbiterMain` / `needsAnswersOnArbiterMain` (A1).

FIRST, drift-check: confirm `prepareTreelessMoveCommit` + `runTreelessLedgerMove` + `catBlob` + `releaseItemLock` still exist in `needs-attention.ts` with the shapes above, the `stuck` SidecarKind still exists, and the shared content builders (`newSidecar` / `serialiseSidecar` / `appendQuestions` / `setNeedsAnswersMarker`) are reusable. If any changed, route to needs-attention with the discrepancy.

CRASH-SAFETY is INHERITED, not re-proven from scratch: because PR-1 routes the primitive through `runTreelessLedgerMove` (lands on `main`, releases in `finally`), the surface-first/release-second ordering is structural. PR-1's tests assert the ordering at the primitive level (surface commit is on `<arbiter>/main` BEFORE the lock is released). The NARROW main-authoritative recovery predicate (A2 in the spec) is wired in PR-2 alongside the seam flip, not here.

## Acceptance criteria

- [ ] `prepareTreelessSurfaceCommit` produces ONE commit on `<arbiter>/main` that (a) writes/appends the `stuck`-kind `work/questions/<type>-<slug>.md` sidecar (reason + any surfaced questions) and (b) sets `needsAnswers:true` on the item body: verified via the new `sidecarSurfacedOnArbiterMain` + `needsAnswersOnArbiterMain` helpers.
- [ ] The primitive touches NO working tree (pure git plumbing): asserted for the protected-`main` / tree-less case.
- [ ] Ordering: driven through `runTreelessLedgerMove`, the surface commit lands on `<arbiter>/main` BEFORE the lock is released: asserted at the primitive level.
- [ ] `bounceToStuckLock` is UNCHANGED and still marks the per-item lock `stuck`; NO existing bounce seam calls the new primitive (this is PR-1, additive). The 137 existing `stuckLockOnArbiter(...).toBe(true)` assertions remain green, unmigrated.
- [ ] The two new helpers `sidecarSurfacedOnArbiterMain` / `needsAnswersOnArbiterMain` are added to `test/helpers/gitRepo.ts` and used by the new tests.
- [ ] Tests cover the primitive (surface content on `main`, no-working-tree, ordering), mirroring the existing lock/sidecar/ledger-write test style.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Explicitly OUT of scope (owned by the PR-2 task `bounce-atomic-cutover-retire-stuck-lock`)

- Flipping either bounce seam (`applyNeedsAttentionTransition` cwd-bound, `applyTreelessNeedsAttentionTransition` tree-less) to the new primitive.
- Removing/replacing `bounceToStuckLock`; migrating the 137 `stuckLockOnArbiter` assertions to the A1 triple.
- Flipping the `agent-stopped` / `agent-failed` / `gate-failed` / `needs-attention`(rebase-conflict) / tasking-lock-failure exit codes to `0` (the empty-diff backstop is EXCLUDED even from PR-2: it is owned by the separate task `empty-diff-bounce-surfaces-dispose-defaulted-question`).
- Wiring the narrow main-authoritative recovery predicate (spec A2).
- Resolving how the cwd-bound bounce seam reaches an on-`main` cwd to run `persistSurfacedQuestions` (that design gap belongs to PR-2, where the cwd-bound flip happens).

## Blocked by

- None: can start immediately.

## Prompt

> Goal (PR-1, ADDITIVE ONLY): add the tree-less surface primitive `prepareTreelessSurfaceCommit`: a git-plumbing 2-file sibling of `prepareTreelessMoveCommit` in `needs-attention.ts` that, in ONE commit on `<arbiter>/main`, writes/appends a `stuck`-kind `work/questions/<type>-<slug>.md` sidecar (reason + any surfaced questions) AND sets `needsAnswers:true` on the item body (both read from `<arbiter>/main` blobs via `catBlob`), run through the EXISTING `runTreelessLedgerMove` CAS loop then `releaseItemLock`. Prove it IN ISOLATION with new tests. Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (user stories 1, 3).
>
> HARD BOUNDARY: this is PR-1: do NOT flip `applyNeedsAttentionTransition` or `applyTreelessNeedsAttentionTransition` to call the primitive; do NOT touch `bounceToStuckLock`/`markStuckItemLock` (every existing bounce still marks the lock `stuck`); do NOT migrate any of the 137 `stuckLockOnArbiter(...).toBe(true)` assertions (owned by PR-2); do NOT change any exit code (owned by PR-2). If you find yourself needing to flip a seam or migrate assertions to make the tree green, STOP and route to needs-attention: that means the boundary is wrong, not that you should cross it.
>
> FIRST, drift-check: confirm `prepareTreelessMoveCommit` + `runTreelessLedgerMove` + `catBlob` + `releaseItemLock` still exist in `needs-attention.ts`, the `stuck` SidecarKind exists, and the shared pure content builders (`newSidecar`/`serialiseSidecar`/`appendQuestions`/`setNeedsAnswersMarker`) are reusable. If any changed, route to needs-attention with the discrepancy.
>
> Where to look (by concept): the existing tree-less plumbing precedent to generalize (`prepareTreelessMoveCommit` + `runTreelessLedgerMove` + `catBlob` + `releaseItemLock` in `needs-attention.ts`, the 1-file move you extend to a 2-file surface); the pure content builders `newSidecar`/`serialiseSidecar`/`appendQuestions` + `setNeedsAnswersMarker` (`surface-persist.ts` shows their use in the cwd-bound path: REUSE the builders, do NOT copy the working-tree commit mechanism); the sidecar identity keying (`sidecarPathFor`); the `stuckLockOnArbiter` test helper + `pathOnArbiterMain`/`existsOnArbiterMain` (`test/helpers/gitRepo.ts`) as the shape for the two new asserters. Seams to test at: drive `prepareTreelessSurfaceCommit` (via `runTreelessLedgerMove`) against a canned arbiter and assert the surface commit lands on `<arbiter>/main` (sidecar + `needsAnswers:true`) with NO working tree touched, THEN the lock releases; assert the ordering (surface-before-release) at the primitive level.
>
> Ordering is load-bearing and INHERITED: routing through `runTreelessLedgerMove` gives surface-to-`main` FIRST, release SECOND for free. Do not re-implement or reverse it. The narrow recovery predicate and the seam flips are PR-2, not here.
>
> Done = `prepareTreelessSurfaceCommit` exists and is proven in isolation (surface content on `main`, no working tree, correct ordering), the two new helpers are added and used, `bounceToStuckLock` and the 137 existing assertions are untouched and green, and the acceptance gate is green. RECORD non-obvious in-scope decisions (e.g. exactly how a reason-only bounce shapes the surfaced sidecar's questions) durably and linked from the done record; if a decision meets the ADR gate, write an ADR.
