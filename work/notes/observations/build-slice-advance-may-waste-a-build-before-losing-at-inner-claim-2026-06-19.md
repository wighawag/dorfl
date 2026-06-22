---
date: 2026-06-19
slug: build-slice-advance-may-waste-a-build-before-losing-at-inner-claim
needsAnswers: false
triaged: keep
---

Noticed while building `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`
(9c): after the advancing MARKER was removed, two concurrent registry-set advance
batches over the SAME mirror can BOTH start building the same build-slice item. The
inner `do` claim lock prevents a double-LAND (one wins, the other's integrate hits a
non-fast-forward and is refused → `usage-error`, one-slug-one-folder held), but the
LOSER may waste a full build before losing at the integrate, instead of losing
cleanly at the claim with no build. The marker used to make the loser back off
BEFORE the build (it spanned classify→integrate); the per-item claim lock is held
claim→durable-move→release, so there is a brief window where a second batch can
re-claim a still-claimable item (e.g. before the winner's durable move lands) and
build it wastefully. This is a slice-7 (lock-release-vs-durable-main-move) /
registry-set-scheduler timing nuance, NOT a correctness defect (no double-land, the
ADR's "loser loses definitively" still holds at the integrate). Captured for later
triage: if the wasted build matters, the registry-set driver could take the
`action: advance` unified lock around the whole build-slice tick (it currently takes
none for build/slice rungs, by design, to avoid deadlocking the inner `do`'s claim).
See `test/advance-registry-set.test.ts` ("two concurrent registry-set batches over
the SAME mirror") which was retargeted to the no-double-LAND invariant.

## Update (2026-06-20, triage)

Re-investigated against current `main`. The window is already much narrower than
this note implies, and the two "obvious" fixes are respectively already-done or
deliberately-rejected, so what remains is a marginal residual, not buildable work.

Mechanism, precisely. The exclusion order is: a claim/build holds the per-item lock
`refs/agent-runner/lock/<entry>`, lands the DURABLE `main` move FIRST, then releases
the lock SECOND (`complete.ts` `releaseClaimLockAfterDurableMove`, slice
`complete-lock-then-durable-main-move-crash-safe`). So a loser B can only waste a
build if B enumerated the item as eligible AND then acquired the now-free lock at a
moment when the winner A has ALREADY moved-and-released but B's clone has not yet
refetched A's move on `main`. The lock acquire (`item-lock.ts`) is `main`-blind by
design (it only fetches the lock-ref namespace + create-only CAS), so B's stale
`main` view is what lets the doomed acquire succeed.

What is ALREADY resolved. Eligibility ALREADY subtracts held locks: the eligible
pool in `scan.ts` is "in `backlog/` on `main` AND no lock held"
(`state.backlog.filter((item) => !heldSlugs.has(item.slug))`, slice
`claim-acquires-unified-lock-no-body-move`, US #15). So B cannot enumerate the item
while A holds the lock; B can only see it eligible-and-unlocked if A has already
completed (moved + released) and B's `main` is stale. That confines the waste to a
stale-`main` PHOTO-FINISH, not a wide hole. This is why the test comment now reads
MAY waste (not WILL).

Fix "A keeps the lock" — REJECTED. The lock is the EPHEMERAL in-flight marker; the
durable `done/` record on `main` is the PERMANENT exclusion. If A kept the lock past
terminal, the recovery model (`reconcileItemLockAgainstMain`: terminal-on-`main` +
lingering lock ⇒ stale ⇒ clear) would clear it anyway, and you'd be fighting your
own GC with a permanent tombstone ref. So keeping the lock duplicates the durable
record's job in a substrate explicitly meant to be cleared on terminal — net worse.

Residual mitigation (marginal, not scheduled). The only remaining shrink is a
CLAIM-TIME terminal recheck: after a successful `acquireItemLock` on the real-claim
path in `claim-cas.ts`, refetch `<arbiter>/main` and if the item is already terminal
(`done`/`dropped`/`brief-sliced`) release the just-taken lock and return `lost`
before building. It shrinks the photo-finish further but CANNOT close it (A can land
in the sub-interval between B's recheck and B's build), and the non-fast-forward
INTEGRATE remains the correctness backstop regardless (no double-LAND, ever). Given
the eligibility subtraction already handles the common case, this is a
micro-optimization on an already-rare event of debatable value — recorded so it is
not re-litigated, deliberately NOT promoted to a task. The note stays as a live
design signal documenting the accepted residual cost.

## Applied answers 2026-06-22

### q1: Triage disposition for this observation: keep as a live design signal documenting an accepted marginal residual, or route otherwise?

KEEP as a live design signal documenting an accepted marginal residual. Verified: the wide eligibility hole is already closed in code (scan eligibility subtracts held-lock slugs via `heldSlugs`), so only the narrow photo-finish residual remains — one wasted build when two builders pass eligibility in the same instant and one loses at the inner claim CAS. No correctness loss (one-slug-one-folder holds; no double-LAND), the event is rare, and a claim-time terminal recheck would shrink but not close the window. The residual is explicitly accepted; no open sub-questions remain. Disposition: keep.

disposition: keep
