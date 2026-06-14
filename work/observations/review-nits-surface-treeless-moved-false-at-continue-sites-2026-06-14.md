---
title: review-gate non-blocking nits for 'surface-treeless-moved-false-at-continue-sites' (Gate 2 approve)
date: 2026-06-14
status: open
slug: surface-treeless-moved-false-at-continue-sites
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'surface-treeless-moved-false-at-continue-sites' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice requires a `## Decisions` block recording (1) the chosen un-moved surface shape, (2) which moved:false is live here, (3) that moved:true is unchanged, and (4) that this is a pre-existing fix. It is not in the diff/tests (it belongs in the PR description, which a fresh-context code reviewer cannot see). Confirm at the PR that the Decisions block is present and complete.
  (git diff and the new test file contain no 'Decisions' text. Work is uncommitted; slice file remains in work/in-progress/ (correct: the runner owns the done-move). This is a process check, not a code defect.)
- Ratify: the agent chose a DISTINCT terminal outcome/status named `surface-unmoved` (over a warning-on-the-same-needs-attention-status or an automatic retry). This is the slice's preferred shape and is coherent with the existing kebab outcome vocabulary, but it is a user-visible new outcome on do/run/start that callers/humans can now branch on.
  (do.ts L119 DoOutcome, run.ts L183 ItemStatus, start.ts L57 StartOutcome each add 'surface-unmoved'. surfaceUnmovedDoResult/ItemResult/StartResult build the honest result carrying reasonNotMoved.)
- Ratify: a cross-cutting choice in run's reporting — surface-unmoved is counted in `failed` and deliberately EXCLUDED from `needsAttention`. This affects run's summary semantics (an unmoved surface is reported as a failure, not as a stuck-but-surfaced item). This is the correct reading (the move never landed) but is a behaviour the slice did not spell out explicitly.
  (run.ts ~L437-457: the failed filter adds `i.status === 'surface-unmoved'`; the needsAttention filter does NOT include it.)
- Ratify: run's surfaceUnmovedItemResult OVERWRITES the local job record (updateJobRecord(tree.dir, {state:'needs-attention', reason: detail})) after the pre-surface updateJobRecord had already set a needs-attention reason. The agent did this so the local record does not confusingly claim a landed surface. The state stays 'needs-attention' locally while the outcome is 'surface-unmoved'; confirm that local/arbiter divergence (local record says needs-attention, item still in-progress on arbiter) is the intended honest representation rather than a contradiction.
  (run.ts surfaceUnmovedItemResult re-calls updateJobRecord with the honest detail; the slice's prompt explicitly flagged that the local updateJobRecord 'records LOCAL state regardless of the arbiter move' and warned the honest result must not contradict it confusingly.)
- Ratify: do.ts forwards start's surface-unmoved end-to-end through runRemotePipeline (a new explicit arm so it does not degrade to usage-error). This is a cross-site interaction (start -> do remote pipeline) the slice implied via 'propagate to callers' but did not name the runRemotePipeline forwarding specifically.
  (do.ts ~L1898-1908: `if (started.outcome === 'surface-unmoved') return {exitCode:1, outcome:'surface-unmoved', slug, branch, message}` added alongside the existing needs-attention forward.)
