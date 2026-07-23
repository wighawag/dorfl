---
title: 'review-gate non-blocking nits for ''empty-diff-bounce-surfaces-dispose-defaulted-question'' (Gate 2 approve)'
date: 2026-07-13
status: open
reviewOf: empty-diff-bounce-surfaces-dispose-defaulted-question
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'empty-diff-bounce-surfaces-dispose-defaulted-question' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: an in-scope inconsistency between do.ts and run.ts for the 'empty-diff but item body cannot be resolved on the arbiter' corner. run.ts falls THROUGH to the old lock-stuck bounce (safe: lock is released / stuck flagged). do.ts RETURNS early with routedToNeedsAttention:false and does NOT invoke any bounce/lock release, so the per-item lock stays held indefinitely on that pathological case. Intentional divergence or copy-paste miss?
  (packages/dorfl/src/do.ts saveAgentStop empty-diff branch vs packages/dorfl/src/run.ts saveAgentStop empty-diff branch)
- Ratify (undocumented in-scope decisions — no Decisions block in the commit/PR body): (a) sentinel STOPs deliberately kept on the OLD lock-stuck bounce path while only empty-diff routes to the new surface primitive; (b) new public exports AgentStopKind / AgentStopClass / emptyDiffDisposeEnvelope from agent-stop.ts; (c) prepareTreelessSurfaceCommit gains an optional envelope override parameter (a caller-facing seam widening).
  (git log -1; src/agent-stop.ts new exports; src/needs-attention.ts prepareTreelessSurfaceCommit envelope? param)
- The 'anti-infinite-loop' test drives the second leg by calling performDo directly on the same slug and accepts either 'agent-stopped' OR 'lost' as the outcome. That is weaker than the AC phrasing ('re-surfaces the same dispose question rather than blindly re-queuing') — it proves nothing was requeued, but does not exercise the eligibility pool that would actually reject a needsAnswers:true item under a runner loop.
  (test/empty-diff-dispose-defaulted.test.ts — second-leg case, expect(['agent-stopped','lost']).toContain(second.outcome))
- Cosmetic: the dispose envelope's context string has a stray unmatched backtick — 'terminal (`git mv → `work/tasks/cancelled/`, retained)' renders with a doubled/misplaced backtick pair.
  (packages/dorfl/src/agent-stop.ts emptyDiffDisposeEnvelope context string concatenation)
