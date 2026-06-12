# `advance-triage` same-slug CAS-race test is flaky under full-suite load

2026-06-11 (noticed while running the acceptance gate for `hub-mirror-strong-replace-guard`)

`test/advance-triage.test.ts > … > a same-slug new-item race ⇒ exactly one promote creates, the loser fails CAS` (around `test/advance-triage.test.ts:409`) intermittently FAILS under the full `pnpm -r test` run with `expected won to have length 1 but got 2` (both racing promotes saw `exitCode 0`, so the CAS did not serialise them). It passes deterministically in isolation (`vitest run test/advance-triage.test.ts`), so it appears to be a load/timing-sensitive flake in the concurrent-CAS fixture, not a real regression. Unrelated to the registry/mirror replace-guard change. Captured for triage; not fixed here.

## RESOLVED 2026-06-12 (slice `triage-cas-race-test-models-real-contention`)

Root cause confirmed (reproduced under load + instrumented): a TEST-FIXTURE artifact, NOT a product-CAS defect. Both racers used the same fixed `gitEnv()` identity and committed the SAME tree change (same path + blob) with the SAME commit message off the SAME base, so git produced a BYTE-IDENTICAL commit object with the SAME sha for both. Whichever pushed second fast-forwarded `main` to a sha it already equalled, and `applyTransition`'s post-push verify (`<arbiter>/main === head`) passed for BOTH → 2 winners. Fixed test-only by giving each racer a DISTINCT committer identity (new `racerEnv`/`raceClone` helpers in `test/helpers/gitRepo.ts`) so the two commits get DISTINCT shas — as two real machines would — and the loser loses through the genuine path-exists/lease CAS. The one-winner assertion is unchanged; full suite is green across 8 consecutive runs.
