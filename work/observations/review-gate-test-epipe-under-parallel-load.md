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
- **2026-06-08** (4th sighting, while conducting the `slicing-coherence` chain):
  same test, same EPIPE, this time it RED the acceptance gate of the
  `slice-output-through-integration` keystone's `do` run — the slice's own work was
  fully GREEN on re-run (1050/1050 + format), so a flake reding a good gate cost a
  needs-attention round-trip (and, compounding it, exposed the no-op
  continue-from-tip gap — see
  `noop-backstop-misfires-on-requeue-continue-from-tip.md`). Re-ran
  `review-gate.test.ts` in isolation: 28/28 green, confirming the flake.

**Suggested fix direction** (when picked up): make `NullHarness.launch`'s piped-prompt
write robust to an early-closed child stdin (ignore `EPIPE` on the prompt write, or
serialise/retry the spawn), since the prompt here is empty anyway. This is the
null/shell ADAPTER's captured-launch path only; the pi adapter + the interactive
launch are unaffected.

## Promoted 2026-06-08

PROMOTED to slice `work/backlog/null-harness-prompt-write-epipe-tolerant.md`.
Delete this observation once that slice lands in `done/`.

## Open question — should Gate-1 also SERIALISE this test? (maintainer, 2026-06-08)

Two independent hardenings are on the table; they are complementary, not
either/or:

1. **FIX the flake at the source** — the promoted slice
   `null-harness-prompt-write-epipe-tolerant`: make `NullHarness.launch`'s
   piped-prompt write tolerant of an early-closed child stdin (ignore `EPIPE` on
   the empty-prompt write, or serialise/retry the spawn). This removes the flake
   itself and is the PRINCIPLED fix.
2. **SERIALISE it in the gate meanwhile** — the suite already has a
   `RACE_SENSITIVE` list in `packages/agent-runner/vitest.config.ts` (a second
   vitest project with `fileParallelism: false`) that pulls git-CAS-race files out
   of parallel pressure. The `review-gate.test.ts` EPIPE is a DIFFERENT race class
   (a spawn-stdin race, not a git-`file://` CAS race), but the SAME mechanism
   would defang it: adding `test/review-gate.test.ts` to `RACE_SENSITIVE` keeps it
   out of the concurrent-load window that triggers the EPIPE, making Gate-1
   deterministic TODAY without waiting on fix #1.

MAINTAINER LEAN (2026-06-08): do BOTH — serialise now (cheap, immediate gate
determinism via the existing `RACE_SENSITIVE` seam) AND keep the source-fix slice
(removes the underlying fragility so the test can eventually rejoin the parallel
pool). The serialise step is arguably its own tiny slice / can ride the
null-harness fix slice; flagged here so it is not lost. NOTE the conceptual
stretch: `RACE_SENSITIVE` is documented as the git-`file://`-CAS bucket — adding a
spawn-stdin flake to it widens its meaning, so either generalise the list's
doc-comment ("tests that flake under file-parallel load", not only CAS races) or
give spawn-races their own labelled group.
