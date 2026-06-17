---
title: complete-from-needs-attention.test.ts has 5 reproducibly-failing tests on master (UNRELATED to the gate-readiness slice)
date: 2026-06-15
status: open
---

## The signal

While working the slice `do-fails-fast-when-acceptance-gate-statically-unrunnable`, the verify gate (`pnpm -r test`) surfaced 5 failing tests in
`packages/agent-runner/test/complete-from-needs-attention.test.ts`:

- `lands it in done/ via merge, no manual git, surfacing reconciled` — expected exit 0, got 1
- `the human never hits a rebase conflict against the surfacing commit` — `'rebase-conflict' !== 'completed'`
- `--skip-verify remains the human-only override (completes without re-gating)` — expected exit 0, got 1
- `keeps the recorded reason in the completed item as durable history` — `ENOENT` reading `work/done/epsilon.md` off the arbiter clone
- `propose mode: recovers from needs-attention by pushing the branch` — expected exit 0, got 1

Reproduced with my src changes STASHED OUT (`git stash push -- packages/agent-runner/src/{complete,do,run}.ts`) — the file still fails 5/8 (same set), so this is NOT caused by the gate-readiness guard I added. The pattern (exit 1 + `rebase-conflict`) suggests the
`complete` recovery-from-needs-attention path is hitting a rebase conflict against the now-on-main surfacing commit before the test expectations, i.e. the test seed `seedSurfacedNeedsAttention` is no longer aligned with the current integration core's rebase semantics. Not investigated further — out of slice scope.

Also seen flaky in the same run:

- `run-uses-advance-tick.test.ts > advanceRegistrySetRunTick — calm-gates OUTCOME-equivalence to plain run\`s build tick > the registry-set advance tick matches runOnce over the SAME fixture` — sporadic
- `run.test.ts > runOnce — GENUINE concurrency safety (multiple jobs in flight) > two same-repo jobs at perRepoMax 2 with the FRESH GATE ON both land` — sporadic (`expected 1 to be 2`)
- `run-internal-error-tests.test.ts > review on with NO reviewGate wired → config-error` — sporadic (`'lost-race' !== 'config-error'`)

## Possible slice shape (later)

Re-derive `seedSurfacedNeedsAttention`'s shape against the current
`performIntegration` rebase semantics so the 5 deterministic failures pass; separately investigate the 3 sporadic ones (likely the same race-sensitive shape they're all already in the `sequential` project for).
