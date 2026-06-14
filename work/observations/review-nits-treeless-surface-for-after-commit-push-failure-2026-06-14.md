---
title: review-gate non-blocking nits for 'treeless-surface-for-after-commit-push-failure' (Gate 2 approve)
date: 2026-06-14
status: open
slug: treeless-surface-for-after-commit-push-failure
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'treeless-surface-for-after-commit-push-failure' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the dropped work-branch push at the do.ts/run.ts continue sites: previously these sites called the cwd-bound `applyNeedsAttentionTransition` WITHOUT `pushBranch:false`, so the cwd path would (best-effort) default-push `work/<slug>`; the new tree-less path pushes NO branch at all. Is suppressing that branch push at these sites intended?
  (The slice's premise says these are PROVABLY ledger-only surfaces because the kept `work/<slug>` is already on the arbiter (rebase-conflict: tip == arbiter tip, a no-op push; push-failure: the kept branch is from the PRIOR requeue and intact, the rebased tip is what failed). Under that premise the old default push was either a no-op or a doomed re-attempt of the just-failed push, so dropping it is correct and is the slice's stated intent (the `start.ts` routes already used `pushBranch:false`). Flagging because it is a real, user-invisible behavioural change to two callers' recovery side-effect that the build made on its own - ratify it. The agent SHOULD have recorded this in a `## Decisions` block.)
- The continue-* callsites do not inspect the `{moved, reasonNotMoved}` result of `applyTreelessNeedsAttentionTransition` - on a contention-exhausted or no-arbiter return (`moved:false`) the run still reports `outcome/status: 'needs-attention'` though the ledger move never landed on main. Acceptable?
  (This is PRE-EXISTING behaviour (the old `applyNeedsAttentionTransition` callsites at these same spots also ignored the result), so it is not a regression introduced by this slice, and `updateJobRecord` still records the local needs-attention state. But the tree-less path has a genuine `moved:false` contention-exhausted exit (5 attempts), so a busy arbiter could now leave the item silently in-progress on main while the run claims needs-attention. Worth a follow-up to surface the un-moved case, out of scope here.)
- Coherence nit: `surfaceToNeedsAttention` and its types are NOT re-exported from `src/index.ts`, whereas the sibling tree-less primitive `returnToBacklog` IS. Intentional, or an omission?
  (The public consumption path is the seam method `ledgerWrite.applyTreelessNeedsAttentionTransition` (which IS reachable), and the tests import the fn directly from `../src/needs-attention.js`, so nothing is broken. But `returnToBacklog` (the requeue-direction sibling this slice mirrors) and `routeToNeedsAttention` are both in the index barrel; leaving the new sibling out is a small consistency gap with that precedent. Easy to add for parity.)
- Confirm the `## Decisions` block exists in the PR description recording (a) the factored-shared-core choice over a duplicated sibling fn, and (b) folding in BOTH push-failure and rebase-conflict. The work is uncommitted at review time so the PR body is not visible in the tree.
  (Both decisions are the slice's OWN stated defaults (it explicitly preferred factoring the shared core, and 'folding in BOTH is the default'), and the implementation matches them exactly, so neither is a surprising un-specified choice - this is a paperwork check, not a design concern. The implementation is sound regardless; just ensure the Decisions block records them so the trail is complete.)
