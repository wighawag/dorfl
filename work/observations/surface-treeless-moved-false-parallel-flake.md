# `surface-treeless-moved-false.test.ts` flakes under file-parallel load

2026-06-14 — While landing `run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe`,
`test/surface-treeless-moved-false.test.ts` (the `|parallel|` vitest project) was
seen to fail ~1-in-7 full-suite runs ("a moved:true surface still reports outcome
needs-attention") yet passes 5/5 in isolation. It is a `start`/surface test that
drives real git against a `--bare` `file://` arbiter AND writes `main`, so it is
the SAME git-`file://`-CAS-under-parallel-pressure class already isolated via
`fileParallelism: false` in `vitest.config.ts` (`RACE_SENSITIVE`). It is unrelated
to this slice's merge/integrate concurrency changes (the merge-push paths are now
deterministic). Candidate fix: add `test/surface-treeless-moved-false.test.ts` to
`RACE_SENSITIVE`, same as the other start/surface-on-main tests.
