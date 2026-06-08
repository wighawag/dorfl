# review-gate.test.ts "substitutes reviewModel through the null/shell {model} placeholder" — flaky EPIPE under parallel load

2026-06-08 — Noticed while building `agent-interactive-launch`. The full `pnpm -r
test` run intermittently fails this test with `failed to spawn harness command:
spawnSync bash EPIPE` (thrown from `NullHarness.launch`, src/harness.ts:236, via
`launchWithOptionalWatch`). It PASSES reliably in isolation (ran 3×, green), so it
is a parallel-load/timing flake in the null adapter's `spawnSync('bash', ['-c',
printf ...])` path — the `printf` child seems to close stdin before the parent
writes the (empty) prompt, surfacing as EPIPE only under heavy concurrent test
load. Unrelated to interactive launch (that path uses `stdio: 'inherit'`, no piped
prompt). Captured, not fixed (out of this slice's scope).
