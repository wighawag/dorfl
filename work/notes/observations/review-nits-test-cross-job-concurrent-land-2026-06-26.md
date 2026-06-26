---
title: review-gate non-blocking nits for 'test-cross-job-concurrent-land' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: test-cross-job-concurrent-land
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'test-cross-job-concurrent-land' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the worker accepts a 'serialiseAfter' parameter (waits for done-<other>) but no test passes it — past-cap test races both workers with cap=0 and lets CAS pick the loser. The top-of-file docblock claims past-cap 'serialises one worker behind a done-<other> marker', which drifts from the actual code (both workers go through the race rendezvous). Either delete the unused branch + correct the comment, or wire past-cap through serialiseAfter for true determinism.
  (packages/dorfl/test/cross-job-concurrent-land.test.ts lines 36–42 docblock vs. the spawnWorker call in the past-cap it() (no serialiseAfter arg); worker code path in helpers/cross-job-land-worker.ts pollUntil(serialiseAfter).)
- Ratify in-scope choices the agent made that the task did not spell out and that are not recorded in a Decisions block: (a) within-cap uses an arbitrary mergeRetries=1000 rather than the resolved default; (b) worker hard-codes mergeJitterMs=0 (deterministic, no jitter on loser retries); (c) freshWorktreeGate forced true inside the worker; (d) verify body fixed to 'exit 0' (delegating broken-merge coverage to clean-rebase-semantic-break.test.ts); (e) tsx resolved as the spawn binary via node_modules/.bin/tsx (couples cross-job test to tsx being installed under packages/dorfl).
  (packages/dorfl/test/helpers/cross-job-land-worker.ts (mergeJitterMs:0, freshWorktreeGate:true); packages/dorfl/test/cross-job-concurrent-land.test.ts spawnWorker mergeRetries:1000 / verify 'exit 0' / TSX_BIN path.)
