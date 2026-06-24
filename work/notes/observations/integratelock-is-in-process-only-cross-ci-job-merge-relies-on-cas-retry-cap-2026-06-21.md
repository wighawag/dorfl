---
title: '`integrateLock` is in-process only; cross-CI-job parallel merge relies on the CAS retry loop, whose cap (5) was sized for in-process siblings'
type: observation
status: spotted
spotted: 2026-06-21
needsAnswers: false
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

## Triaged: promoted

Promoted to a new backlog task `work/tasks/todo/integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21.md`
(a human answered "promote", disposition `promote-adr`). This observation is
resolved; the new item carries the work.

Manual completion of an INTERRUPTED promote (2026-06-24): a prior advance tick
(`f09a2ed`, 2026-06-22) already CREATED the promoted task through the create-CAS
but never landed step 2 (record + resolve the observation), so the answered
observation sidecar was left in place and every subsequent `advance "obs:<slug>"`
re-lost the now-impossible create-CAS (the target already exists) and exited 2 in
a loop. Completing step 2 by hand here: appended this block, cleared
`needsAnswers`, and deleted the observation's answered sidecar
(`work/questions/observation-integratelock-...md`) -- exactly what
`promoteObservation` step 2 would have committed. The promoted TASK's own surfaced
sidecar (`work/questions/task-integratelock-...md`) is intentionally left untouched
(it carries the task's open scoping questions).

Per the answer's steer (`promote-adr`): prefer FOLDING the durable rule (across
runners the arbiter-ref CAS IS the merge queue; within a runner the in-process
`integrateLock` is only an optimisation; size `DEFAULT_MERGE_RETRIES` / add a
cross-job concurrency-group mutex for the matrix width on purpose) into the
`land-time-reverify-and-parallel-merge-ceiling` brief's eventual ADR rather than
spinning a standalone one. The general idempotency gap that produced the retry
loop is tracked separately by
`observation-triage-re-fires-when-task-for-observation-already-exists-2026-06-22`.
