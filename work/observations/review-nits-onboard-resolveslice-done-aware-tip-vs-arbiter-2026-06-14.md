---
title: review-gate non-blocking nits for 'onboard-resolveslice-done-aware-tip-vs-arbiter' (Gate 2 approve)
date: 2026-06-14
status: open
slug: onboard-resolveslice-done-aware-tip-vs-arbiter
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'onboard-resolveslice-done-aware-tip-vs-arbiter' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: do.ts passes the continue gate UNCONDITIONALLY (both in-place and remote pipeline) and relies on isStrandedDoneTip to self-gate, while run.ts passes the gate only when tree.continued. Is the asymmetric expression of 'only on a continue' acceptable, or should do.ts also guard structurally for clarity?
  (do.ts lines ~805 and ~1811 pass `{branchRef, mainRef, ...}` always; run.ts line ~590 wraps it in `tree.continued ? {...} : undefined`. Both are safe because isStrandedDoneTip returns false for an unresolved branch ref or a tip reachable on main, and the same predicate (branchAheadOf) is what isolation.ts uses to set `continued`, so do.ts cannot admit done/ for a true fresh cut. The difference is readability/intent, not behaviour.)
- Ratify: isStrandedDoneTip re-implements branchAheadOf (rev-parse tip + !isAncestor(tip, main)) instead of calling branchAheadOf directly. Reuse the existing helper to avoid a second copy of the stranded/ahead-of-main predicate?
  (continue-branch.ts `branchAheadOf` already answers 'tip exists AND is not an ancestor of main' with the same empty-ref-=>-false rule. The slice required reusing the `isAncestor` primitive (done), but the new function forks the higher-level helper that the continue-detection itself uses. Reusing branchAheadOf would make the 'stranded == ahead-of-main' equivalence explicit and single-sourced.)
- Ratify the user-visible PromptError message change: it now lists the folders actually searched (so 'work/done/' appears when it was in scope) instead of the fixed 'work/in-progress/ or work/backlog/'.
  (prompt.ts resolveSlice now throws `no slice '<slug>' found in ${searched}` where searched is derived from the resolution order. This is an improvement (the message stays honest about what was searched) but is an unspecified default the slice did not call out.)
