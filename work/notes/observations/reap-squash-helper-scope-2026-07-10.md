# 2026-07-10 — scope of `isProvablyMergedForReap` rollout

Task `reap-squash-merged-remote-work-branches` listed six files where the
ancestry-only test appears. I wired the new squash-aware helper in at the
four call sites that DECIDE REAP-SAFETY (the criterion the task's Acceptance
section names): `gc.ts` `evaluateDeletionSafety` (2a merged branch), the
remote sweep in `reap-branches.ts`, `integrator.ts`
`deleteMergedHeadBranch` (L686 — post-merge remote-head reap), and
`complete.ts` `isLocalBranchProvablyOnArbiter` (L1323 — local-branch reap).
`integration-core.ts`'s reap-lane is transitively covered via the
`deleteMergedHead: true` invocation that reaches `deleteMergedHeadBranch`,
and `isolation.ts`'s reap-lane via `reapJob` → `evaluateDeletionSafety`.

Left as pure ancestry (NOT reap-safety, so out of the helper's scope):
`integrator.ts` L617 (`mergePushOnce` push-landed idempotency probe),
L766 (`arbiterMainContains`, a general-purpose public helper),
`integration-core.ts` L1707 (`recoverAlreadyCommitted` integration
no-op / already-integrated detection), and `isolation.ts` L405
(`assertClaimCommitReachable`, the "refuse to build on a stale claim base"
guard). Swapping the squash-aware predicate in there would re-mean the
check (idempotency / staleness / claim-reachability are not reap-safety)
and could cause a subtle divergence — e.g. `recoverAlreadyCommitted`
reading "already integrated" for a squash-landed lookalike whose branch
would still need a rebase. Keep the reap helper narrow.

## Ratification (2026-07-11, continuation of the requeued task)

Gate 2 approved the work but raised a non-blocking nit
(`review-nits-reap-squash-merged-remote-work-branches-2026-07-10.md`): the task
Acceptance names six files but only four were rewired — please ratify or push
back. On the continuation I re-verified the two contested sites
independently:

- `integration-core.ts` `recoverAlreadyCommitted` (the `already-integrated`
  short-circuit) is an integration-IDEMPOTENCY check. Swapping in the
  squash-aware predicate would let a squash-landed LOOKALIKE (done record on
  main, tip not genuinely reachable) falsely report "already integrated" and
  skip a needed rebase/re-push.
- `isolation.ts` `assertClaimCommitReachable` is a claim-REACHABILITY guard
  that must demand GENUINE ancestry of the claim commit; a done-record match
  would defeat its purpose (refusing to build on a stale base).

Both are pure-ancestry semantics, NOT reap-safety, so they correctly stay on
the raw `isAncestor`. Reap-safety in those two modules is transitively covered:
`integration-core` via `deleteMergedHead: true` → `integrator.deleteMergedHeadBranch`
(rewired), `isolation` via `reapJob` → `gc.evaluateDeletionSafety` (rewired).
DECISION: RATIFIED — the helper stays scoped to the four reap-safety sites.
The rationale now also lives at each choice site as JSDoc
(`integration-core.ts` L~1707, `isolation.ts` `assertClaimCommitReachable`) so
a future reader sees WHY the raw predicate was deliberately kept there without
hunting this note.

The task body Acceptance bullet 1's literal "6 files" wording over-counts: two
of the six named sites are pure-ancestry callers whose semantics the helper
must NOT re-mean. This is a scope refinement of the task text, not a deviation
from its intent (its intent, stated in the same bullet, is "the SOLE decision
point for REAP-SAFETY"). No source change is warranted beyond the durable
rationale above and at the choice sites.
