---
title: '`integrateLock` is in-process only; cross-CI-job parallel merge relies on the CAS retry loop, whose cap (5) was sized for in-process siblings'
type: observation
status: spotted
spotted: 2026-06-21
---

# `integrateLock` is in-process only; cross-CI-job parallel merge relies on the CAS retry loop, whose cap (5) was sized for in-process siblings

2026-06-21

`run.ts` builds the integrate serialiser with `createKeyedLock()` (an in-memory
keyed lock) and threads it as `integration-core.ts`'s `integrateLock` seam, keyed
on `repoPath`. That serialises the land-tail across jobs WITHIN ONE `run` process.

It does NOT span separate OS processes / separate GitHub Actions jobs. So if the CI
advance-loop ever fans merge mode out into a parallel matrix (one job per item,
separate runners), the in-process lock provides no cross-job serialisation: the
ONLY thing keeping concurrent lands deterministic across jobs is the
`mergeRetries` CAS loop (non-fast-forward push -> re-rebase + re-gate + retry).

That is correct in principle (the arbiter ref CAS is the real linearisation point,
and it is host-agnostic: it works against a bare `--bare` arbiter with
`NoneProvider`, no GitHub needed). But:

- `DEFAULT_MERGE_RETRIES = 5` was chosen for `O(concurrent same-repo run siblings)`
  convergence. A WIDE CI matrix (N independent jobs all racing the same `main`)
  could exceed it under a burst, routing losers to needs-attention as
  "persistent contention" rather than landing them. The cap may need to scale with
  expected matrix width, or the matrix may need a cross-job mutex (e.g. a
  ref-based lock / a concurrency group) so it degrades to a queue, not to
  needs-attention bounces.

Decision to record when the CI parallel-merge shape is designed: across runners,
the CAS loop IS the queue; within a runner, the lock is the optimisation. Size the
retry cap (or add a cross-job concurrency group) for the matrix width on purpose.

Not fixing here: a sizing/design decision for the future parallel-merge CI shape,
captured so it is not rediscovered in production as spurious needs-attention bounces.
