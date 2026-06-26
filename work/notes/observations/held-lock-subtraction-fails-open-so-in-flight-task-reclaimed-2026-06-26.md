---
title: propose-mode releases the per-item lock at PR-OPEN, not at PR-merge, so an in-flight task is re-claimable across the whole review window (empty diff then spurious 'stuck')
date: 2026-06-26
status: open
---

## CORRECTION (2026-06-26, supersedes the fail-open theory below)

The fail-open lock-read theory in the original body is NOT the root cause.
Evidence that disproves it: the CI log shows the leg `CLAIMED` the task. The
claim is a create-only push (`acquireItemLock`, `--force-with-lease=<ref>:`
empty-expected) that succeeds ONLY if the lock ref is ABSENT. So at claim time
the lock was GONE, not held. A held lock would have made the claim `lost`,
regardless of the eligibility scan. So the question is not why the subtraction
missed a held lock; it is why the lock was ABSENT for an in-flight task.

ROOT CAUSE: in `propose` mode the per-item lock is released at PR-OPEN, not at
the durable `main` move. `performComplete` (complete.ts ~L1029) calls
`releaseClaimLockAfterDurableMove` UNCONDITIONALLY on the success path, before
the mode-specific tail. Its name + comment assert 'the durable `main` move
ALREADY landed FIRST', true in MERGE mode, FALSE in PROPOSE mode: there the
done-move (`git mv tasks/ready -> done`, integration-core step 2) is committed
on the WORK BRANCH and pushed as the PR; `<arbiter>/main` is NOT touched. So on
a successful propose build the lock is released while the body is STILL in
`tasks/ready/` on `main` (the move lands only when a human MERGES the PR).

Result: across the entire PR-review window the task is BOTH unlocked AND in
`tasks/ready/` on `main`, i.e. fully eligible. The hourly advance cron (or a
sibling matrix leg in the same run) re-enumerates it, claims it cleanly (lock
absent, the `CLAIMED` in the log), rebuilds, the PR meanwhile merges, the diff
is empty, and the runner marks the lock `stuck`. Deterministic, not flaky; it
fires for every propose-built task whose PR stays open across an advance tick,
which is why it hit several tasks across one 70-leg run.

The 14 'leaked' locks are then mostly this bug's `stuck` marks (the release at
PR-open already cleared the cleanly-merged ones), NOT out-of-band-merge leaks.

FIX DIRECTION: bind the lock release to the DURABLE move, which in propose mode
is the PR MERGE, not PR-open. Keep the lock HELD (state `active`, or a new
`in-review`/`proposed` state) for an open propose PR so the held-slug
subtraction keeps the in-flight item out of the pool for the whole window; the
lock is released when the work actually lands on `main` (merge), reconciled by
`reconcileItemLockAgainstMain` if the merge happens out-of-band. The comments
corrected in commit 43bbc47 still stand (the subtraction IS load-bearing); the
fail-closed-on-read-fault idea below is defence-in-depth, not the root fix.

--- ORIGINAL (fail-open theory, KEPT for the record, but SUPERSEDED above) ---

## What was observed

advance-lifecycle (propose mode) re-claimed already-complete tasks whose work
was on `main`, the build produced an empty diff (nothing to do), and the runner
marked the per-item lock `stuck`, redding CI. Observed for at least
`propose-push-survives-stale-lease-on-reaped-work-ref` (and the same shape is
latent for every propose-merged task). The CI log:

```
CLAIMED '<slug>' (lock held; body stays in work/backlog/ on origin/main).
... agent produced no source change (empty diff vs the arbiter main); treating as a no-op/stop
Bounced '<slug>' to stuck (lock): ...
Error: Process completed with exit code 1.
```

## Root cause (single)

The eligible-pool predicate is "in `tasks/ready/` on `main` AND no lock held".
The "no lock held" half is the held-slug SUBTRACTION (`scoreItems` in
`scan.ts`, fed by `heldTaskSlugs` in `item-lock.ts`).

Since the lock cut-over the claim NO LONGER moves the body to `in-progress/`
(it stays in the pool on `main`; the held lock IS the claim), so the held-slug
subtraction is now the ONLY thing keeping a claimed / in-flight item out of the
pool. It is LOAD-BEARING, not the redundant belt-and-suspenders the (now-fixed)
comments described.

But the subtraction FAILS OPEN: `heldTaskSlugs` / `listItemLocks` return an
EMPTY set on any lock-read fault (best-effort, `catch { return [] }`), and
`scoreItems` then does `ready.filter(s => !heldSlugs.has(s))` with an empty set,
i.e. "subtract nothing". So on a transient lock-read fault the in-flight item
collapses back to "in `tasks/ready/` on `main`" alone and reads as ELIGIBLE,
becomes a matrix leg, and is re-claimed. The agent finds the work already on
`main` (empty diff) and the runner mislabels that benign no-op as `stuck`.

Note (corrects an earlier theory): this is NOT a propose-window TOCTOU where
the lock was free. In propose mode the done-move + lock release happen at PR
MERGE out-of-band, so dorfl's `releaseCompletedItemLock` never runs and the
lock stays HELD the entire time (these are exactly the leaked locks `gc --ledger`
reports). The lock was held continuously; the ONLY way the item leaked into the
pool is the fail-open read. Fix the fail-open and the item is excluded for the
whole window.

## The fix (fail CLOSED for selection, keep graceful for the surface)

The SAME `heldTaskSlugs` / `listItemLockEntries` readers feed two consumers:

- the read-only `status` / `scan` SURFACE, where degrade-to-empty on a fault is
  the correct graceful behaviour ("no in-flight locks shown");
- the SELECTION input (`scoreItems`'s subtraction), where degrade-to-empty is a
  correctness bug.

So the SELECTION path must distinguish "read OK, set empty" from "read FAILED"
and fail CLOSED on a read failure: do NOT enumerate / select tasks when the held
set could not be trusted (skip the tick, or treat the pool as unknown), rather
than re-making held items eligible. The underlying reader can keep its
best-effort empty-on-fault contract for the surface; selection needs an explicit
ok/failed signal (e.g. a `{ok, held}` result or a throwing selection-only
variant) so it can fail closed.

## Related / also worth a follow-up

- Leaked locks: propose/PR-merge landing never runs dorfl's lock release, so
  every propose-merged task leaves a held `refs/dorfl/lock/task-<slug>` until a
  human runs `gc --ledger --reap-stale-locks` (no auto-sweep by design). 14 such
  stale locks currently held, all for `done/` tasks. Separate hygiene gap; a CI
  cron step or a release-on-PR-merge hook would address it.
- Runner-layer: an empty-diff-because-already-landed build could be treated as a
  benign no-op (not `stuck`), mirroring the propose-push benign-already-landed
  fix just landed. Defence in depth, not the root cause.

The comments in `scan.ts` / `item-lock.ts` were corrected in commit 43bbc47;
this observation is the durable home for the actual fail-closed fix. Mark
RESOLVED when selection fails closed on a lock-read fault.
