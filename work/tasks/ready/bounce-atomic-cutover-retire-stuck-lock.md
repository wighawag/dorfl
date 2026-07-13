---
title: Atomic cutover: flip both bounce seams to surface + migrate the 137 assertions + flip exit codes (PR-2)
slug: bounce-atomic-cutover-retire-stuck-lock
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: [bounce-surfaces-stuck-sidecar-and-releases-lock]
covers: [1, 3, 4, 8]
---

## Why this is a SEPARATE task (split 2026-07-13)

The original single task was self-contradictory (full-cutover acceptance criteria vs. an additive-PR-1 slicing plan under one-task-per-PR). It was split: **PR-1** (`bounce-surfaces-stuck-sidecar-and-releases-lock`) adds the tree-less surface primitive ADDITIVELY and keeps `bounceToStuckLock` alive. **THIS task is PR-2, the ATOMIC cutover**: flip BOTH bounce seams to the new primitive AND migrate the 137 `stuckLockOnArbiter` assertions in ONE change, because retiring the `stuck`-producing seam instantly falsifies every `stuckLockOnArbiter(...).toBe(true)` assertion (a green tree requires the seam flip and the assertion migration to land together). This task is BLOCKED BY PR-1 (it consumes the primitive + the two helpers PR-1 adds).

## Design decision that MUST be resolved before this is claimed (the A4 cwd-on-`main` gap)

The prior single file left this genuinely unresolved and it is load-bearing for PR-2: the cwd-bound bounce seam `applyNeedsAttentionTransition` (via `complete.ts`) runs with the cwd on `work/<slug>` (post wip-save), but `persistSurfacedQuestions` requires a cwd on `main` (it does `writeFileSync(itemPath)` where `itemPath` is a `work/…/<slug>.md` on `main`, then `git add` + `git commit` in the cwd). The prior A4 rejected both "scratch-clone-per-bounce" and "thread a writable `treelessCwd`" but did NOT say how the cwd-bound path reaches `main`.

**Resolution for PR-2: use `prepareTreelessSurfaceCommit` (the PR-1 tree-less plumbing primitive) on BOTH seams.** The cwd-bound seam does NOT need a writable-`main` checkout at all if it surfaces via the SAME git-plumbing primitive the tree-less seam uses (it reads body + sidecar from `<arbiter>/main` blobs and commits via scratch index: no working tree, so the cwd being on `work/<slug>` is irrelevant). This makes both seams share ONE surface mechanism, supersedes the prior A4's "cwd-bound uses `persistSurfacedQuestions`" split, and removes the unanswerable cwd-on-`main` question. `persistSurfacedQuestions` remains the cwd-bound SURFACE-RUNG mechanism (that rung genuinely runs on `main`); only the BOUNCE seam moves to the plumbing primitive. If, on inspecting the code, this unification turns out to be wrong (e.g. the cwd-bound seam has state the tree-less path cannot see), STOP and route to needs-attention with the specific obstruction rather than reintroducing a writable-`main` assumption.

## What to build

1. Flip BOTH bounce seams (`applyNeedsAttentionTransition` cwd-bound and `applyTreelessNeedsAttentionTransition` tree-less) from the pure lock-amend `bounceToStuckLock` to the PR-1 surface primitive: ONE ordered crash-safe transition per the spec (write/append the `stuck`-kind sidecar + set `needsAnswers:true` in one commit on `<arbiter>/main`, THEN release the lock). Both seams use `prepareTreelessSurfaceCommit` via `runTreelessLedgerMove` then `releaseItemLock` (see the A4 resolution above).
2. Retire the `stuck` lock production: after this task NO bounce leaves a `stuck` lock; the item rests as a plain `needsAnswers:true` pool item (`eligible:false` by construction). Remove/retire `bounceToStuckLock`/`markStuckItemLock` from the bounce path (the broader `stuck` STATE removal in `gc --ledger` / `resumeItemLock` / `release-lock` is the separate contract task `retire-stuck-lock-state`; here we just stop PRODUCING `stuck` from bounces).
3. Wire the NARROW, main-authoritative recovery predicate (spec A2): a held per-item lock whose item on `<arbiter>/main` carries `needsAnswers:true` + a matching sidecar is CLEARABLE. Add only the minimal predicate for the new path; do NOT rewrite the existing `stuck`-based recovery (owned by `retire-stuck-lock-state`). The new main-authoritative check and the old `stuck`-based recovery COEXIST interim.
4. Migrate ALL 137 `stuckLockOnArbiter(...).toBe(true)` assertions (across 30 test files) to the A1 triple observable using the PR-1 helpers: (a) `stuckLockOnArbiter(repo, slug).toBe(false)` (lock RELEASED), (b) `sidecarSurfacedOnArbiterMain(repo, slug)` (sidecar exists on `<arbiter>/main`), (c) `needsAnswersOnArbiterMain(repo, slug)` (body `needsAnswers:true` on `<arbiter>/main`).
5. Flip the exit codes (spec decision #1 + user story #8): every bounce outcome that routes through the surface transition becomes `exitCode: 0` WHEN ITS SURFACE TRANSITION SUCCEEDED, for `agent-stopped`, `agent-failed`, `gate-failed`, `needs-attention`(rebase-conflict), tasking-lock-failure. A FAILED surface (sidecar not written / lock not released) stays non-zero. Update the pinned exit-code assertions accordingly. **EXCLUDE the empty-diff backstop** (its exit code is owned by the separate task `empty-diff-bounce-surfaces-dispose-defaulted-question`); do NOT touch it here.

## Acceptance criteria

- [ ] Both bounce seams surface (sidecar + `needsAnswers:true` in one commit on `main`) THEN release the lock, in the correct order: verified end-to-end for BOTH the cwd-bound and the tree-less/protected-`main` path (the tree-less one touches no working tree).
- [ ] After a bounce, NO `stuck` lock remains for the item (the lock is released, not amended to `stuck`); the item is a `needsAnswers:true` pool item that is `eligible:false`.
- [ ] Crash-safety: a simulated crash between step 1 and step 2 (and before step 1) resolves deterministically from `main` via the new narrow predicate: never a dangling `needsAnswers` with no sidecar, never a held lock with an already-surfaced item.
- [ ] All 137 `stuckLockOnArbiter(...).toBe(true)` assertions are migrated to the A1 triple; the tree is green with `bounceToStuckLock` retired from the bounce path.
- [ ] A cleanly-surfaced bounce returns `exitCode: 0` for `agent-stopped` / `agent-failed` / `gate-failed` / `needs-attention`(rebase-conflict) / tasking-lock-failure; a bounce whose surface transition FAILED returns non-zero. The empty-diff backstop exit code is UNTOUCHED (owned by its own task).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `bounce-surfaces-stuck-sidecar-and-releases-lock` (PR-1): this task consumes the `prepareTreelessSurfaceCommit` primitive and the two test helpers it adds.

## Prompt

> Goal (PR-2, ATOMIC cutover): flip BOTH bounce seams (`applyNeedsAttentionTransition` cwd-bound + `applyTreelessNeedsAttentionTransition` tree-less) from the pure lock-amend `bounceToStuckLock` to the PR-1 surface primitive `prepareTreelessSurfaceCommit` (one ordered crash-safe transition: surface sidecar + `needsAnswers:true` on `<arbiter>/main` FIRST, release lock SECOND), retire `stuck` production from the bounce path, wire the narrow main-authoritative recovery predicate, migrate all 137 `stuckLockOnArbiter(...).toBe(true)` assertions to the A1 triple, and flip the bounce exit codes to 0-on-clean-surface: ALL IN ONE change (the seam flip falsifies the 137 assertions, so they are inseparable). Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (user stories 1, 3, 4, 8; decisions #1, #4). BLOCKED BY PR-1.
>
> BEFORE building, RESOLVE the A4 cwd-on-`main` gap using the task's stated resolution: BOTH seams surface via `prepareTreelessSurfaceCommit` (git plumbing, no working tree), so the cwd-bound seam being on `work/<slug>` is irrelevant and no writable-`main` checkout is needed for the bounce. `persistSurfacedQuestions` stays the SURFACE-RUNG mechanism only. If inspecting the code shows this unification is wrong, STOP and route to needs-attention with the specific obstruction: do NOT reintroduce a writable-`main` assumption.
>
> Where to look: the bounce/needs-attention seams (`applyNeedsAttentionTransition` + `applyTreelessNeedsAttentionTransition`) + `bounceToStuckLock`/`markStuckItemLock`; the PR-1 primitive `prepareTreelessSurfaceCommit` + `runTreelessLedgerMove` + `releaseItemLock` (`needs-attention.ts`); the recovery paths `gc --ledger` / `resumeItemLock` / `release-lock` (add the NEW narrow predicate only; do NOT rewrite the `stuck`-based one); the `stuckLockOnArbiter` helper + the PR-1 `sidecarSurfacedOnArbiterMain`/`needsAnswersOnArbiterMain` helpers (`test/helpers/gitRepo.ts`); the pinned exit-code assertions in the do / do-remote tests.
>
> EXCLUDE the empty-diff backstop from the exit-code flip: it is owned by `empty-diff-bounce-surfaces-dispose-defaulted-question`. Do NOT couple to it.
>
> Ordering is load-bearing: surface-to-`main` FIRST, release SECOND (crash leaves a recoverable state). Do NOT reverse it. RETRY (rebase+re-push on CAS rejection) is orthogonal contention handling and still applies.
>
> Done = both seams surface+release in order, no `stuck` lock remains after a bounce, crash-safety holds via the new predicate, all 137 assertions migrated + green, bounce exit codes green-on-clean-surface (empty-diff untouched), acceptance gate green. RECORD non-obvious in-scope decisions (the exact recovery predicate; how a reason-only bounce shapes the sidecar's questions) durably and linked from the done record; if a decision meets the ADR gate, write an ADR.
