---
title: 'integration-core "retry DISABLED (mergeRetries: 0), N=7 items" test times out on a clean tree'
type: observation
status: resolved
spotted: 2026-07-20
resolvedDate: 2026-07-21
triaged: keep
---

> RESOLVED 2026-07-21. Took the observation's first suggested follow-up: gave
> BOTH heavy N=7 real-git contention tests in `integration-core.test.ts` (the
> `mergeRetries: 0` DISABLED control at ~L979 and its sibling ALL-land test at
> ~L907) an explicit generous `30000` per-test timeout — the same budget
> `stale-lease-all-push-sites.test.ts` uses for its heavy git test. Both pass in
> ~4-5s in isolation; the flake was the default 5s per-test timeout being too
> tight under full-suite CPU/IO load (the file already runs in the `sequential`
> `fileParallelism:false` project, so this was NOT cross-file parallel pressure).
> The generous ceiling removes the intermittent RED without masking a real hang.
> Deliberately did NOT do the deeper clock/sleep-seam injection or a slow-suite
> tag (the other two suggested options) — out of scope for de-flaking the gate.

## What was seen

While working on the gate-failure-context enrichment (`formatGateFailureContext` +
`RunVerifyResult.failedCommand/outputTail`), the test

- `test/integration-core.test.ts` › `with the retry DISABLED (mergeRetries: 0), N=7 DIFFERENT items in…`

**timed out** (hit the default vitest per-test timeout, ~5s / then the 60s run cap).

Reproduced on a CLEAN tree (my changes stashed): the failure is PRE-EXISTING and
unrelated to this change — `git stash && vitest run integration-core -t "with the retry DISABLED"`
still fails (1 failed | 38 skipped). So this is a flaky/slow concurrency-timing test,
not a regression.

## Why it matters

- It reds `pnpm -r test` (the acceptance gate) intermittently, which makes the
  gate untrustworthy and can wrongly bounce unrelated work at land time — exactly
  the class of opaque land-time bounce this session's other change makes more
  legible. A flaky gate is the worst kind because it teaches humans to ignore red.
- The whole `pnpm -r test` run is also very heavy (>10min wall in this
  environment), dominated by concurrency/merge-contention timing tests; worth a
  look at whether these can be made deterministic (inject a clock/sleep seam) or
  moved behind a slow/integration tag.

## Refs

- `packages/dorfl/test/integration-core.test.ts` around L979 (`const N = 7`).
- Sibling timing tests in the same file (the `mergeRetries`/CAS-contention block).

## Suggested follow-up (not done here)

- Give the N=7 contention test an explicit generous `testTimeout`, OR
- Inject the sleep/backoff seam so it does not depend on real wall-clock racing, OR
- Tag the heavy timing suite so the default gate runs the deterministic bulk fast
  and the timing suite runs on an opt-in/CI lane.
