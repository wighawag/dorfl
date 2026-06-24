<!-- dorfl-sidecar: item=observation:git-integration-tests-time-out-under-parallel-load-2026-06-24 type=observation slug=git-integration-tests-time-out-under-parallel-load-2026-06-24 allAnswered=false -->

## Q1

**What becomes of this signal — promote it to a task that raises the per-test `testTimeout` (or caps parallelism) for the git-heavy integration tests, keep it as a watch-item, or drop it as a transient CI-load flake?**

> Observation `work/notes/observations/git-integration-tests-time-out-under-parallel-load-2026-06-24.md`: under full `pnpm -r test` (≈230s wall, 765s cumulative) two git-heavy tests hit the default 5000ms per-test timeout — `packages/dorfl/test/complete-self-renaming-folder-task.test.ts:160` (DIRTY-CONTINUE) and `packages/dorfl/test/do-isolated.test.ts:445` (SEQUENTIAL-REFETCH FRESHNESS drain). Both pass 17/17 in ≈5s when run in isolation, so the cause is parallel-load CPU starvation, not a logic defect. `packages/dorfl/vitest.config.ts` does not set a project-wide `testTimeout` override for these git-heavy projects, so they inherit the 5s default. The observation's own author-written open question already asks: raise per-test `testTimeout` for these files, or cap suite parallelism? Either is a small, well-scoped change — task-sized, not PRD-sized.

_Suggested default: promote-task — mint a task to either bump `testTimeout` on the git-integration test files (or their vitest project) to a value comfortable under loaded CI, or cap the suite's pool size, so a loaded box stops flaking these._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

promote-task — mint a task to either bump `testTimeout` on the git-integration test files (or their vitest project) to a value comfortable under loaded CI, or cap the suite's pool size, so a loaded box stops flaking these. (This is the same signal the build agent captured during the surface-promote-prd task — one observation, one task.)
