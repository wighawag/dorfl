---
title: 'De-flake the integration-core serialisation control test and two load-sensitive timeouts'
slug: deflake-the-integration-core-control-and-two-load-timeouts
blockedBy: []
---

## What to build

Three tests fail `verify` intermittently, unrelated to the PR under test:

1. **`integration-core.test.ts` > "WITHOUT the lock AND WITHOUT the retry, two same-base concurrent merges do NOT both cleanly land (serialisation is load-bearing)"** (observation `integration-core-serialisation-load-bearing-flake-2026-07-13`). It failed CI on three separate PRs on 2026-09-28 (#437, #442 era, #443) with `expected 2 to be less than 2`. The test is a negative race control: it starts two un-locked, un-retried `integrateMerge` calls with `Promise.allSettled` and asserts that at most one lands. That is only true if both rebase onto the same stale base before either pushes; if one job finishes before the other fetches, both land legitimately. The assertion depends on scheduling, not on the code.
2. **`surface-treeless-moved-false.test.ts`** > "a moved:true surface still reports a clean needs-attention (happy path unchanged)" hits the default 5000 ms timeout under full-suite load (observation `surface-treeless-moved-false-times-out-under-full-suite-load`).
3. **The requeue conflicting-continue-rebase test** times out under load (observation `requeue-conflicting-continue-rebase-test-timeout-under-load`).

For (1), make the interleaving deterministic: force both jobs to finish their rebase against the same stale base before either pushes (a barrier through an existing test seam, or a small new test-only seam on the integrate tail), so the control proves what it claims every time. If you find that a deterministic version cannot be written without distorting the product, replace it with a deterministic sequential equivalent that still proves "no lock and no retry ⇒ the second push is rejected", and say so in Decisions. Do not just loosen the assertion or add retries.

For (2) and (3), give them explicit timeouts in line with their git-heavy siblings, after checking that nothing in them is actually slow for a fixable reason (for example an un-stubbed sleep or backoff).

## Acceptance criteria

- [ ] The integration-core control passes deterministically: run it at least 20 times in a loop, some of them under parallel load (for example alongside the rest of `integration-core.test.ts`), and report the result in Decisions.
- [ ] The control still fails if the product's second push were accepted (reason it through in Decisions, or demonstrate by temporarily breaking it locally).
- [ ] The two timeout tests have explicit, justified timeouts (or their slowness fixed).
- [ ] The three observations are marked resolved.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: these three tests stop failing unrelated PRs. Read the three observations named above, `integration-core.ts` (the merge tail, `mergeRetries`, the integrate lock and any existing test seams such as sleep/fetch hooks), `test/integration-core.test.ts` (`twoSameRepoMergeJobs`, the control and its sibling "WITH the default retry" test), `test/surface-treeless-moved-false.test.ts` and the requeue continue-rebase test.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED). If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). The task body lives in `work/tasks/backlog/` (a deliberate drive-from-staging build).
>
> RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output; repeated test loops get a `timeout` too) and never run an unbounded regex over `node_modules`, `dist` or lockfiles. Never read or write real home state from tests.
