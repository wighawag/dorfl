---
title: review-gate non-blocking nits for 'requeue-from-in-progress' (Gate 2 approve)
date: 2026-06-13
status: open
slug: requeue-from-in-progress
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'requeue-from-in-progress' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify (or reverse) the probe-order tie-break vs the freshly-landed one-slug-one-folder invariant: when resolving the requeue source, `resolveRequeueSourceRel` SILENTLY picks `needs-attention/` over `in-progress/` if a slug ever appeared in both, whereas the prior slice (#99) made a slug-in-two-folders state FAIL LOUD. The agent reconciled this in-comment (the invariant means at most one folder holds the slug, so the tie-break is defensive), which is reasonable — but it is a cross-slice interaction with a brand-new invariant and the agent recorded no `## Decisions` block (the changes are still uncommitted under only a `claim:` commit, so there was no PR description to start from). Confirm the silent needs-attention-first preference is the intended behaviour rather than a fail-loud-on-both to match the invariant.
  (packages/agent-runner/src/needs-attention.ts resolveRequeueSourceRel() loops ['needs-attention','in-progress'] and returns the FIRST hit; the comment cites the one-slug-one-folder invariant (see integration-core.ts:1418 'one-slug-one-folder invariant violated' which FAILS LOUD). Two different dispositions of the same ambiguous state.)
- Two refusal/abort messages still hardcode 'item left in needs-attention' even though the source may now be `in-progress/`. After a failed `--reset` branch delete, or after contention-retry exhaustion, on an in-progress-sourced requeue the user is told the item is in needs-attention when it is actually still in in-progress. Worth updating to 'left in its current folder' (or the resolved `sourceRel`) so the message stays accurate now that the source domain is broadened.
  (packages/agent-runner/src/needs-attention.ts line ~526 ('aborting the requeue — item left in needs-attention (no backlog move).') and line ~630 ('item left in needs-attention (no move).'). The slice broadened the source folder but these two strings were not updated; the primary refusal message and the docblocks WERE updated, so this is an inconsistency, not a functional defect.)
- Ratify the implicit keep+continue precondition for an in-progress strand: the default (keep+continue) path keeps a requeue-safety guard (work branch must be on the arbiter and ahead of main) that ABORTS if absent, directing the user to push it or use `--reset`. For a genuine un-surfaced abort where NOTHING was pushed, the default requeue will refuse and the user must `--reset`. The slice's test fixture always pushes a prior-attempt commit so the guard passes, so this real-world path (nothing pushed) is not exercised. Confirm 'no pushed branch -> must --reset' is the intended UX for that sub-case (it is consistent with the pre-existing requeue-continue-and-reset guard, so this is ratification, not a defect).
  (packages/agent-runner/src/needs-attention.ts: the `if (!options.reset)` branchAheadOf guard (pre-existing from requeue-continue-and-reset) gates the keep+continue move; the new test's stuckInProgress() always commits+pushes work/slice-<slug> before requeuing, so the branch-absent default path is covered only indirectly by the guard's message, not by a dedicated in-progress test case.)
