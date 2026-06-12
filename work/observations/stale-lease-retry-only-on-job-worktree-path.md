# Stale-lease push retry covers only the job-worktree continue path

2026-06-12 — The `work-branch-push-retry-on-stale-lease` slice added stale-lease
retry (`pushContinuedBranchWithStaleLeaseRetry`) to the `createJob` continue path
in `workspace.ts` (the `run`/`do --remote` job-worktree path — the observed
`advance-verb-resolver` incident). The SAME single `--force-with-lease=<branch>`
continue-path push, with the same latent stale-lease failure mode, also exists in
two sibling sites left untouched (out of this slice's scope): `isolation.ts` (the
in-place checkout strategy, ~line 260) and `start.ts` `switchToWorkBranch`
(~line 542). If a stale-lease strands work on those paths too, factor those pushes
through the same new helper.
