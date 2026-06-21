# Propose mode's re-gate covers the PR-PUSH tip, not the PR-MERGE-time tip: a human merging later (after `main` moved) is outside the runner's fresh-worktree gate

2026-06-21

`freshWorktreeGate` (default ON) makes the runner gate the work branch REBASED onto
the latest `<arbiter>/main` at the moment the runner integrates. For MERGE mode that
moment IS the land, so the gated tree is the merged tree -- airtight, host-agnostic.

For PROPOSE mode the runner's job ends at "push branch + open PR". The human (or an
auto-merge) clicks merge LATER. Between the runner's push-time rebase+gate and that
click, `main` can advance again. The runner cannot re-gate that window because the
runner is not the one merging. So propose mode's "verify ran on the merged tree"
guarantee holds at PUSH time, not at MERGE time. A human reviewing the PR diff has
the SAME stale-base blind spot as a clean `git` merge: both judge the change against
the base it was authored/pushed on, not the base it will live on.

This is the ONE place the git-alone floor cannot fully close the gap by itself; it
needs either a host feature or a runner-side re-gate-at-merge. Per the project steer
(git-alone = correctness floor; the host only RAISES the ceiling, GitHub as the
benchmark), the intended shape is a two-tier realisation of the SAME
"land = rebase onto current main + re-run verify + advance" primitive the runner
already implements:

- Bare-host / git-alone floor: the gap only closes when the RUNNER performs the
  merge (then its fresh-worktree gate covers it). A human-merged PR on a bare
  arbiter is gated at push time only -- documented as a known limitation, with the
  mitigation being "let the runner do the merge" or "manually re-run verify after
  rebase before merging".
- GitHub (benchmark) ceiling: branch protection "require branches up to date before
  merging" + a required `verify` status check forces a rebase + re-verify against
  current `main` before the merge button works (step 1); a merge queue
  (`merge_group` trigger) does speculative-rebase composition checking and removes
  the rebase churn (step 2). These do NOT replace human review -- review stays
  additive; the re-verify is the gate. A capable-but-not-GitHub host slots between
  bare and GitHub by whatever subset it supports.

Key doctrine to write down once, mode-agnostic: a clean `git` merge AND a
human-approved diff both validate the change in the context it was AUTHORED, not the
context it will LIVE; only re-running acceptance on the post-rebase tree proves
correctness. Propose and merge therefore share ONE landing primitive; human review
is additive, never the gate.

Not fixing here: this is the residual design gap + the two-tier (bare-floor /
host-ceiling) plan to close it, captured for the propose-mode-landing-safety slice.
