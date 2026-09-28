# `ci-phase-build.test.ts` reads the real `GITHUB_RUN_ATTEMPT`, so every CI re-run of `verify` fails it

Date: 2026-09-28
Observer: conductor (drive-tasks), Gate-3 of PR #437.

On PR #437, a "re-run failed jobs" of the `verify` workflow failed `test/ci-phase-build.test.ts > the lock phase > publishes the trusted facts of a claim`. The test expected `handoffName: dorfl-handoff-task-add-thing-attempt-1` and got `...-attempt-2`. `ci-phase-build.ts` (around line 414) computes the attempt as `options.runAttempt ?? env.GITHUB_RUN_ATTEMPT ?? '1'`, and the test does not pin `runAttempt` or clear `GITHUB_RUN_ATTEMPT`. On a GitHub runner the variable is set, so the test passes on attempt 1 and fails on every re-run. The same pattern is in `ci-phase-intake.ts` (around line 361); its tests may have the same exposure.

Why it matters: "re-run failed jobs" is the natural response to a flaky `verify` (this suite has known flakes, e.g. the integration-core serialisation test that failed the first attempt of the same PR). With this leak, the re-run always fails, so a flake cannot be cleared by re-running, only by starting a fresh run (the conductor closed and reopened the PR to get one). The failure also points at unrelated code.

Likely fix: in the tests, pass `runAttempt` explicitly or run the phase with an env that drops `GITHUB_RUN_ATTEMPT` (and `GITHUB_RUN_ID`), following the shared-write isolation rule for ambient CI env.

> RESOLVED 2026-09-28 by task `ci-phase-tests-pin-the-run-attempt`: the CI-phase tests (`test/ci-phase-*.test.ts`, including the `*-e2e` ones whose workers inherit the parent's env) now run their phases on `ciPhaseEnv()` (`test/helpers/gitRepo.ts`), which is `gitEnv()` minus every ambient `GITHUB_*` / `RUNNER_*` / `ACTIONS_*` value, so a re-run on attempt 2 sees attempt 1 unless a test pins it. `ci-phase-build.test.ts` has a regression test that stubs `GITHUB_RUN_ATTEMPT=2` in the test process. The product's env precedence is unchanged. The signal is spent once that lands; suggested disposition: delete.
