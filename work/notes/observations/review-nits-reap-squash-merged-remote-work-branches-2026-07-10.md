---
title: review-gate non-blocking nits for 'reap-squash-merged-remote-work-branches' (Gate 2 approve)
date: 2026-07-10
status: open
reviewOf: reap-squash-merged-remote-work-branches
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'reap-squash-merged-remote-work-branches' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the scope narrowing: task Acceptance names 6 files (reap-branches.ts, gc.ts, integrator.ts, integration-core.ts, complete.ts, isolation.ts) as sites that must use the shared helper, but only 4 were rewired. integration-core.ts L1707 (recoverAlreadyCommitted 'already-integrated' short-circuit) and isolation.ts L405 (assertClaimCommitReachable) still call the raw isAncestor. Agent rationale in work/notes/observations/reap-squash-helper-scope-2026-07-10.md: those sites are pure-ancestry semantics (integration idempotency / claim-reachability), not reap-safety, so swapping the squash-aware predicate in would re-mean them; reap-safety in integration-core is transitively covered via deleteMergedHead→deleteMergedHeadBranch (integrator.ts) and in isolation via reapJob→evaluateDeletionSafety (gc.ts). Reasoning is coherent (keeps the helper concept narrow to reap-safety), but it deviates from the literal task text — please ratify or push back.
  (work/notes/observations/reap-squash-helper-scope-2026-07-10.md; task Acceptance bullet 1 in work/tasks/done/reap-squash-merged-remote-work-branches.md)
- No 'Decisions' block was recorded in the commit/PR body — the scope-narrowing decision above only lives in a work/notes observation. Consider surfacing such decisions in the PR body per AGENTS guidance so future reviewers see them without hunting.
  (git log 5a1f828e -1 --format=%B has only the subject line; the scope decision lives only in work/notes/observations/reap-squash-helper-scope-2026-07-10.md)
