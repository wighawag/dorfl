---
title: held-lock subtraction fails OPEN on a lock-read fault, so a continuously-held in-flight task can be re-enumerated and re-claimed (empty diff then spurious 'stuck')
date: 2026-06-26
status: open
---

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
