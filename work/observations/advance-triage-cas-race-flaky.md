# `advance-triage` same-slug CAS-race test is flaky under full-suite load

2026-06-11 (noticed while running the acceptance gate for `hub-mirror-strong-replace-guard`)

`test/advance-triage.test.ts > … > a same-slug new-item race ⇒ exactly one promote creates, the loser fails CAS` (around `test/advance-triage.test.ts:409`) intermittently FAILS under the full `pnpm -r test` run with `expected won to have length 1 but got 2` (both racing promotes saw `exitCode 0`, so the CAS did not serialise them). It passes deterministically in isolation (`vitest run test/advance-triage.test.ts`), so it appears to be a load/timing-sensitive flake in the concurrent-CAS fixture, not a real regression. Unrelated to the registry/mirror replace-guard change. Captured for triage; not fixed here.
