# claim CAS retry left a stale `claim/<slug>` branch (fixed in run-daemon-reframe)

2026-06-07 — In `src/claim-cas.ts`, `attempt()` deleted+recreated the throwaway
`claim/<slug>` branch with `git branch -D` then `checkout -b`. On a RETRY (the CAS
push was rejected because `<arbiter>/main` advanced under us), HEAD was still ON
`claim/<slug>` from the prior attempt, so `git branch -D <current-branch>` refused
and the re-`checkout -b` failed with "a branch named 'claim/<slug>' already
exists" → spurious `claim-error`. It was latent because the sequential `run`
rarely advanced main mid-claim; `run-daemon-reframe`'s genuinely-CONCURRENT tick
made a sibling job's merge advance main routinely, surfacing it. Fixed in this
slice (it was required for the "claim-race safety under parallelism" acceptance
criterion) by detaching HEAD onto `<arbiter>/main` BEFORE the delete+recreate, so
the branch reset is idempotent across attempts. Covered by the merge-mode
concurrency-caps tests in `test/run.test.ts`.
