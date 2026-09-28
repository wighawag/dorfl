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

> FORWARD-NOTE (conductor, 2026-09-28): the same negative-race pattern also flaked CI on #446: `merge-retries-external.test.ts` > "mergeRetries (resolved through config): cap controls bounce vs converge > with the resolved cap at 0, two disjoint-file same-repo merges do NOT both cleanly land" (`expected 2 to be less than or equal to 1`). It is in scope: make it deterministic the same way as the integration-core control (ideally through one shared barrier helper), and search for any other "two concurrent X do NOT both land" control with the same shape.

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

## Decisions

- **Control made deterministic with a barrier, not rewritten as a sequential test.** The barrier holds jobs at the existing `integrationLand` test seam, which `performIntegration` calls after its rebase and before the push. The product code is unchanged. Holding the jobs there reproduces exactly the interleaving the control claims to test: both jobs rebased onto the same stale base, then both push. The alternative was a sequential rewrite, but it wasn't needed because this version doesn't distort the product. The in-process barrier lets jobs push one at a time in arrival order, so the push outcome doesn't depend on concurrent `file://` pushes. The cross-process worker still pushes concurrently, as its test intends ("race to push"), but only after both processes have rebased.
- **Stronger assertions.** With the order fixed, the controls now check exact outcomes. In the two-job control, the first released job is `completed` and on `main`. The second is `rebase-conflict`, routed to needs-attention, with a `non-fast-forward push` reason, and is not on `main`. The N=7 control and the merge-retries-external test get the equivalent. The two-job control, the N=7 control and the merge-retries-external test also get explicit 30s timeouts, since the barrier's own timeout is 20s.
- **Run results.** The integration-core control ran 24 times, all green:
  - 12 runs on its own (`-t` filter).
  - 12 runs under parallel load: 3 rounds of 4 concurrent vitest processes, each running all of `integration-core.test.ts` plus `merge-retries-external.test.ts` plus `cross-job-concurrent-land.test.ts`. That is 12 × 33 tests passing, which also covers 12 load runs each of the N=7, cap=0 and cross-process controls.
  - The full gate then passed once.
- **The control still catches an accepted second push.** I checked this by temporarily changing the control's `mergeRetries` from `0` to `5`, so the second push is retried and accepted. The control then failed with `expected 'completed' to be 'rebase-conflict'`. I reverted the change afterwards. By reasoning: the second job's branch is built on a base the first push already moved past. Any product change that lets that push land (a force push, or a retry at cap 0) turns its outcome into `completed` and puts it on `main`, which fails three separate assertions.
- **Observations deleted rather than marked resolved.** WORK-CONTRACT says a spent note "leaves the inbox by deletion" and there is "no `resolved` status". This work fully replaces their signal, so I deleted the three notes and the serialisation note's unanswered question file (`work/questions/observation-integration-core-serialisation-load-bearing-flake-2026-07-13.md`). The new test comments cite the task slug instead of the deleted notes. I left the ENOTEMPTY observation alone. Its text still mentions this flake family, but its own signal is still live.
- **Timeout scope.** I only added timeouts to the two named tests. The moved:true `run` and `start` siblings in `surface-treeless-moved-false.test.ts` take about the same time and could hit the same limit later. I didn't touch them to keep scope tight; they are the next candidates if they ever flake.
- **No changeset.** The change is test-only and nothing a user sees, and no check requires one for test-only edits.
