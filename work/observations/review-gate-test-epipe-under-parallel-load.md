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

## Recurrence (consolidated)

This is now seen at least TWICE — well past the "a second instance is a signal,
not noise" threshold:

- **2026-06-07** (first sighting, while running the full vitest suite during an
  unrelated slice): same `test/review-gate.test.ts > harnessReviewGate …
  substitutes reviewModel through the null/shell {model} placeholder` failing with
  `failed to spawn harness command: spawnSync bash EPIPE` (src/harness.ts), passing
  26/26 in isolation. (This merges the former duplicate note
  `review-gate-test-flaky-spawn-epipe-under-load.md`.)
- **2026-06-08** (above): same test, same EPIPE, root cause narrowed to the null
  adapter's `spawnSync('bash', ['-c', printf …])` path — the `printf` child appears
  to close stdin before the parent writes the (empty) prompt, surfacing as EPIPE
  only under heavy concurrent test load.

**Suggested fix direction** (when picked up): make `NullHarness.launch`'s piped-prompt
write robust to an early-closed child stdin (ignore `EPIPE` on the prompt write, or
serialise/retry the spawn), since the prompt here is empty anyway. This is the
null/shell ADAPTER's captured-launch path only; the pi adapter + the interactive
launch are unaffected.

## Promoted 2026-06-08

PROMOTED to slice `work/backlog/null-harness-prompt-write-epipe-tolerant.md`.
Delete this observation once that slice lands in `done/`.
