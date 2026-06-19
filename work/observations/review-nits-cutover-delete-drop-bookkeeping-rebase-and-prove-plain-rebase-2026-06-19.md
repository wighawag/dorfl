---
title: review-gate non-blocking nits for 'cutover-delete-drop-bookkeeping-rebase-and-prove-plain-rebase' (Gate 2 approve)
date: 2026-06-19
status: open
reviewOf: cutover-delete-drop-bookkeeping-rebase-and-prove-plain-rebase
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'cutover-delete-drop-bookkeeping-rebase-and-prove-plain-rebase' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the additional deletion of `surfaceToNeedsAttention` and `resolveSurfaceSourceRel` from needs-attention.ts, which goes beyond the slice's literal scope (it named only the trailer producer). Was deleting these now (vs leaving them for a later cleanup) intended?
  (The slice text said to remove the `route-to-needs-attention` trailer producer. The diff additionally deletes the whole `surfaceToNeedsAttention` function (~170 lines) and its `resolveSurfaceSourceRel` helper. These were already dead code after 9b re-pointed `applyTreelessNeedsAttentionTransition` to `bounceToStuckLock` (verified: the only src occurrence at parent commit afaa625 was the function's own definition; `appendReasonBlockText` retains a live caller so it was not orphaned). The deletion is sound, but it is an in-scope decision the agent made on its own and did not record.)
- The PR/commit has no `## Decisions` block despite the slice note instructing 'Record non-obvious in-scope decisions per the slice template.' Should the surface-deletion decision (and the choice to drop the `slug` param from the public `pushContinuedBranchWithStaleLeaseRetry`/`rebaseContinuedBranchOntoMain` signatures rather than keep it as a no-op) be recorded?
  (Removing `slug` from the exported continue-rebase/push signatures is a small public-API change to two functions consumed across isolation.ts/start.ts/workspace.ts; it is correct and the gate is green, but it is the kind of cross-call-site signature decision a Decisions block exists to surface.)
- The `routeToNeedsAttention` function-level docstring still describes the old behaviour ('TWO commits ... a move-only commit on top (the tip): ... `git mv work/<src>/<slug>.md work/needs-attention/<slug>.md`'), which contradicts the current body and its own inline comment ('there is NO `git mv` to needs-attention/'). Should it be corrected?
  (This stale docstring predates 9d (it should have been updated when 9b made the bounce a pure lock amend), but it lives in needs-attention.ts which 9d edited, and it now actively misdescribes the code a future reader will trust. Doc-only, non-load-bearing, hence non-blocking.)
