---
date: 2026-06-19
slug: build-slice-advance-may-waste-a-build-before-losing-at-inner-claim
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
