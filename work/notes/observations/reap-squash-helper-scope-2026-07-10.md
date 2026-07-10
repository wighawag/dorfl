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
