<!-- dorfl-sidecar: item=observation:review-nits-test-cross-job-concurrent-land-2026-06-26 type=observation slug=review-nits-test-cross-job-concurrent-land-2026-06-26 allAnswered=false -->

## Q1

**What becomes of the `serialiseAfter` drift nit — promote to a small cleanup task, keep as durable note, or delete?**

> The worker accepts a `serialiseAfter` parameter (waits for done-<other>) but no test passes it. The past-cap docblock at packages/dorfl/test/cross-job-concurrent-land.test.ts lines 36–42 claims past-cap 'serialises one worker behind a done-<other> marker', but the actual past-cap `it()` calls `spawnWorker` with no `serialiseAfter` arg, so both workers race the rendezvous and CAS picks the loser. The dead code path is in helpers/cross-job-land-worker.ts `pollUntil(serialiseAfter)`. Two honest fixes: (a) delete the unused branch + correct the comment, or (b) wire past-cap through `serialiseAfter` for true determinism.

_Suggested default: Promote to a small cleanup task: pick option (a) — delete the unused `serialiseAfter` branch from the worker and rewrite the past-cap docblock to match the race-based reality. Option (b) only if we actually want past-cap to be deterministic, which the review did not flag as required._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote a small cleanup task, option (a): delete the unused `serialiseAfter` branch from the worker (helpers/cross-job-land-worker.ts `pollUntil(serialiseAfter)`) and rewrite the past-cap docblock to match the actual race-based reality. Option (b) (wire past-cap through serialiseAfter for determinism) only if we actually want past-cap deterministic, which the review did not flag as required. The dead code + lying comment is a real (if small) maintenance trap.

## Q2

**What becomes of the in-scope-choices nit — promote to a Decisions-block backfill task (record (a)–(e) on the original task), keep as durable note, or delete?**

> The agent made five in-scope choices the task did not spell out and that no Decisions block records: (a) within-cap uses arbitrary `mergeRetries=1000` rather than the resolved default; (b) worker hard-codes `mergeJitterMs=0` (deterministic, no jitter on loser retries); (c) `freshWorktreeGate` forced `true` inside the worker; (d) verify body fixed to `exit 0` (delegating broken-merge coverage to clean-rebase-semantic-break.test.ts); (e) `tsx` resolved as the spawn binary via `node_modules/.bin/tsx` (couples cross-job test to tsx being installed under packages/dorfl). See packages/dorfl/test/helpers/cross-job-land-worker.ts (`mergeJitterMs:0`, `freshWorktreeGate:true`) and packages/dorfl/test/cross-job-concurrent-land.test.ts (`spawnWorker` `mergeRetries:1000`, verify `exit 0`, `TSX_BIN` path).

_Suggested default: Keep as durable note (this observation IS the record). Each of (a)–(e) is a defensible local test-scaffolding choice, not an architectural commitment; only escalate to a task if one of them later bites (e.g. the tsx coupling breaks CI on a different layout)._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Keep as a durable note (this observation IS the record). Each of (a)-(e) is a defensible local test-scaffolding choice, not an architectural commitment. Escalate to a task only if one later bites, e.g. if the tsx coupling (`node_modules/.bin/tsx`) breaks CI on a different layout.
