<!-- dorfl-sidecar: item=observation:fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load type=observation slug=fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load allAnswered=false -->

## Q1

**What becomes of this signal: should the gateSandboxCount() concurrency flake be turned into a fix task now, kept as an open observation, or dropped?**

> Verified against current code: packages/dorfl/test/fresh-worktree-gate.test.ts:68 gateSandboxCount() does readdirSync(tmpdir()).filter(d => d.startsWith('dorfl-fresh-gate-')) — a PROCESS-WIDE temp-dir scan, not a per-test scope. The OFF-path assertions (lines 249, 273, 336, 510, 532) snapshot `before` then expect the count unchanged, so under full parallel `pnpm -r test` a sibling test legitimately creating a `dorfl-fresh-gate-*` sandbox can be observed mid-flight and the OFF-path reads before+1 (the 2-failed/2583-passed flake seen at :511). Isolated `vitest run` of the file passes 16/16 and a re-run of the full suite passed 2585/2585, confirming flake-not-regression. The observation already names a concrete fix direction (scope the count to this test's own sandbox root/prefix or a unique tag, or assert a delta keyed to this test's own gate invocation; do NOT serialise the whole file). No existing task in work/tasks/ addresses it. The item is still needsAnswers:true / untriaged with no sidecar.

_Suggested default: Mint a small test-hardening task to scope the assertion to this test's own sandbox (unique per-test prefix/tag, delta keyed to this test's gate invocation), per the fix direction already captured; then delete this observation. It is a real, reproducible test-isolation bug that will keep producing spurious CI/gate failures, so it is worth fixing rather than leaving open or dropping._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
