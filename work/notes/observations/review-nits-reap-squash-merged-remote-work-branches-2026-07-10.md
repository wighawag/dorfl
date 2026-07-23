---
title: 'review-gate non-blocking nits for ''reap-squash-merged-remote-work-branches'' (Gate 2 approve)'
date: 2026-07-10
status: resolved
reviewOf: reap-squash-merged-remote-work-branches
needsAnswers: false
triaged: resolve
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'reap-squash-merged-remote-work-branches' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the scope narrowing: task Acceptance names 6 files (reap-branches.ts, gc.ts, integrator.ts, integration-core.ts, complete.ts, isolation.ts) as sites that must use the shared helper, but only 4 were rewired. integration-core.ts L1707 (recoverAlreadyCommitted 'already-integrated' short-circuit) and isolation.ts L405 (assertClaimCommitReachable) still call the raw isAncestor. Agent rationale in work/notes/observations/reap-squash-helper-scope-2026-07-10.md: those sites are pure-ancestry semantics (integration idempotency / claim-reachability), not reap-safety, so swapping the squash-aware predicate in would re-mean them; reap-safety in integration-core is transitively covered via deleteMergedHead→deleteMergedHeadBranch (integrator.ts) and in isolation via reapJob→evaluateDeletionSafety (gc.ts). Reasoning is coherent (keeps the helper concept narrow to reap-safety), but it deviates from the literal task text — please ratify or push back.
  (work/notes/observations/reap-squash-helper-scope-2026-07-10.md; task Acceptance bullet 1 in work/tasks/done/reap-squash-merged-remote-work-branches.md)
- No 'Decisions' block was recorded in the commit/PR body — the scope-narrowing decision above only lives in a work/notes observation. Consider surfacing such decisions in the PR body per AGENTS guidance so future reviewers see them without hunting.
  (git log 5a1f828e -1 --format=%B has only the subject line; the scope decision lives only in work/notes/observations/reap-squash-helper-scope-2026-07-10.md)

## Resolution (2026-07-11, requeued continuation)

Both nits addressed on the continuation:

1. Scope narrowing RATIFIED. The two contested sites (`integration-core.ts`
   `recoverAlreadyCommitted`, `isolation.ts` `assertClaimCommitReachable`) were
   re-verified independently: they are pure-ancestry semantics (integration
   idempotency / claim-reachability), NOT reap-safety, so the squash-aware
   helper must not re-mean them. Their reap-lanes are transitively covered by
   the four rewired sites. Full ratification + rationale:
   `work/notes/observations/reap-squash-helper-scope-2026-07-10.md` §Ratification.
2. Decision now SURFACED at the choice sites (not just an observation): the
   "deliberately raw ancestry, not the squash-aware helper" rationale is now
   JSDoc at both `integration-core.ts` (the `already-integrated` short-circuit)
   and `isolation.ts` `assertClaimCommitReachable`, plus a `## Decisions`
   summary in this task's done record body / completion. A future reader sees
   WHY without hunting.

No functional code change was needed — the four-site rollout was already
correct; the requeue only needed the decision made durable and discoverable.
