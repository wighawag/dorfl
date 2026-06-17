---
title: review-gate non-blocking nits for 'recover-autodetect-gated-on-nothing-to-commit' (Gate 2 approve)
date: 2026-06-17
status: open
reviewOf: recover-autodetect-gated-on-nothing-to-commit
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'recover-autodetect-gated-on-nothing-to-commit' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the choice of `ledgerWrite.applyNeedsAttentionTransition` as the surface seam and the exact reason-message wording (the continue-specific text naming `complete --isolated <slug>` and `requeue --reset <slug>`). The slice's Decisions block explicitly asked the builder to record both, but the PR description / commit body has no `## Decisions` block — only the slice's pre-existing human-ratified Option-D entry. The choice itself looks right (same seam other autonomous failure paths use; it commits the agent's wip below the move-only tip so the work travels on the branch), but it is a user-visible default that should be ratified rather than implicit.
  (complete.ts ~L509-545 chooses `ledgerWrite.applyNeedsAttentionTransition` and constructs the `reason` + the two `message` variants (success / surface-failed fallback). The seam commits wip → publishes move-only commit on arbiter main; the message contents are now load-bearing for human recovery.)
- Ratify the resolution of the edge the slice explicitly flagged: 'a confused continue-agent that COMMITS its own work would leave a CLEAN tree + new source commits ahead of the kept tip, which the working-tree-dirty check alone would MISS'. The slice asked the builder to DECIDE while building (working-tree-dirty sufficient vs. also gate on `HEAD != claimCommit`) and record it. The diff picks 'working-tree-dirty only' (no claimCommit comparison added) — defensible as 'committed-agent-work is out of scope / a convention-enforcement concern owned elsewhere', but this is a residual data-loss hole on a non-conforming agent and should be ratified explicitly rather than chosen by omission.
  (complete.ts gate uses only `hasUncommittedSourceChanges`; no comparison to a recorded `claimCommit`. The slice spec called this edge out specifically and asked for a recorded decision; the PR description does not record one.)
- Coherence: should the success-path message wording be slightly normalised against the other autonomous surface messages? The current text leads with 'Refused to silently auto-recover stranded-done '<slug>' …' which is clear, but the codebase's other `routeToNeedsAttention` consumers tend to lead with `Routed '<slug>' to needs-attention: <reason>`. Not a defect — just worth a glance for consistency of the user-visible surface vocabulary.
  (complete.ts ~L532-545 message construction vs. `needs-attention.ts` `note('Routed '${slug}' to needs-attention: ${options.reason}')` (already emitted by the seam itself, so the user sees BOTH the seam's 'Routed …' note AND complete.ts's 'Refused to silently auto-recover …' note — intentional?).)
