---
title: review-gate non-blocking nits for 'rename-advance-rung-and-sliced-outcome-tokens' (Gate 2 approve)
date: 2026-06-23
status: open
reviewOf: rename-advance-rung-and-sliced-outcome-tokens
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'rename-advance-rung-and-sliced-outcome-tokens' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Stale doc comment: do.ts:548 still lists the OLD outcome word in the passthrough contract comment ('outcomes pass through (sliced / gate-refused / stale / agent-failed / usage-error)'). The token it names was just renamed to 'tasked' in this same file (do.ts:132/558-559), so this comment now references a non-existent outcome. It is directly in the rename's blast radius and was missed. Cosmetic only (a comment, no behaviour), but worth a one-word fix 'sliced' -> 'tasked' in a follow-up sweep.
  (packages/dorfl/src/do.ts:548 — `* contract: outcomes pass through (sliced / gate-refused / stale / agent-failed /`)
- In-scope decision to RATIFY: the agent also edited packages/dorfl/src/integration-core.ts (3 occurrences), a file the task's body did NOT list among the files to touch (it named do.ts/tasking.ts/intake.ts for the outcome rename). The change is comment-only (the commitTag doc comment + an inline comment saying the tasking transition supplies 'tasked' instead of 'sliced') and is correct + coherent — leaving it as 'sliced' would have stranded a stale comment naming the renamed tag. No '## Decisions' block was recorded in the PR description (there is no PR-description artifact at all). Ratify: extending the comment sweep to integration-core.ts is the right call.
  (git diff dbc13d5^ d3b2ac7 -- packages/dorfl/src/integration-core.ts (lines 153-159, 922-926: commitTag JSDoc + inline comment, 'sliced' -> 'tasked'); task body lists only do.ts/tasking.ts/intake.ts for Rename 2.)
