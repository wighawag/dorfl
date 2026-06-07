# review-gate test flaky `spawnSync bash EPIPE` under heavy parallel load

2026-06-07 — While running the full vitest suite, `test/review-gate.test.ts >
harnessReviewGate ... substitutes reviewModel through the null/shell {model}
placeholder` failed with `Error: failed to spawn harness command: spawnSync bash
EPIPE` (src/harness.ts:160). Re-running that file in isolation passes (26/26), so
it appears to be an environmental flake when many test files spawn `bash`
concurrently, not a logic bug. Noting in case it recurs and warrants a spawn
retry / serialisation guard.
