# 2026-06-06 — the seam needs-attention path does NOT push `work/<slug>` to the arbiter

The `requeue-continue-and-reset` slice's premise says "the branch is ON the
arbiter to continue from ... which it is: stuck items push the branch via
`routeToNeedsAttention(arbiter)`." That is only partly true today:

- `routeToNeedsAttention` (in `src/needs-attention.ts`) DOES push `work/<slug>`
  to the arbiter when given `arbiter`.
- BUT the seam wrapper `applyNeedsAttentionTransition` (in `src/ledger-write.ts`)
  deliberately DROPS the arbiter from the move (`const {arbiter, ...move} =
  input`) and only publishes the move-only *surface* commit to `main` via
  `publishSurfaceCommit` — it does NOT push the work branch. So the autonomous
  `run`/`do` stuck paths (which go through the seam) leave the `work/<slug>`
  branch LOCAL to the job worktree, not on the arbiter.

Consequence (handled, not a blocker for this slice): the continue-detection
must be robust to the arbiter `work/<slug>` ref being ABSENT and fall through to
the normal fresh-cut-off-main path (which it does). Continue only kicks in when
the branch IS present on the arbiter (e.g. a human `requeue` after `start`/
`complete` pushed it, or a future change that pushes the branch on bounce). The
slice is implementable as specified; this note records the premise nuance for a
possible follow-up (pushing the work branch on autonomous bounce so the
fleet/AFK recovery actually has a branch to continue from).
