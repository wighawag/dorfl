<!-- agent-runner-sidecar: item=observation:run-internal-error-config-error-flakes-as-lost-race-under-load type=observation slug=run-internal-error-config-error-flakes-as-lost-race-under-load allAnswered=false -->

## Q1

**What becomes of this observation — the `run-internal-error-tests.test.ts` "config-error vs agent-failed" case flaking as `lost-race` once under full-suite parallel load?**

> The observation reports a single failure of `runOnce — review on with NO reviewGate wired → config-error` resolving to `lost-race` during a `pnpm -r test` run while landing the `promote` command (diff: `cli.ts` + `needs-attention.ts` only — nothing in the run/claim path). The file passed 3/3 in isolation and the full gate passed 2300/2300 on re-run; the failure appeared exactly once under heavy parallel load. Author's read: shared arbiter/claim state racing a sibling under load, NOT a real defect in the config-error path. Suggested follow-up: a small fix slice that either isolates the test's arbiter/claim state (dedicated scratch arbiter) or makes the assertion tolerate a `lost-race` outcome (retry/exclude). Closely matches a recurring pattern in this repo — sibling observation `triage-cas-race-test-still-flakes-under-parallel-load` (2026-06-13) describes a structurally identical "green logic, racy under load" flake, and at least three landed slices have addressed the same shape (`serialise-review-gate-test-under-parallel-load`, `serialise-surface-treeless-moved-false-test-under-parallel-load`, `triage-cas-race-test-models-real-contention`). The author themselves hedges: "Worth a small fix slice if it recurs; capturing now so the signal is not lost."

_Suggested default: keep — single occurrence so far, and the author's stated bar is "if it recurs"; leaving it open preserves the signal so that the next recurrence (or batched test-isolation work covering all the "racy under load" siblings) can promote it then. A reasonable alternative is `promote-slice` now (small slice: dedicated scratch arbiter for this test, mirroring the established serialise-X-test pattern) on the grounds that the pattern is already recurring across siblings and a one-off fix is cheap._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):
