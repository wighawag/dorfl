---
title: 'CI-phase tests pin the run attempt instead of reading the real GITHUB_RUN_ATTEMPT, so a CI re-run can pass'
slug: ci-phase-tests-pin-the-run-attempt
blockedBy: []
---

## What to build

Observation `ci-phase-build-test-reads-the-real-github-run-attempt-2026-09-28`: `ci-phase-build.ts` (and `ci-phase-intake.ts`) compute the attempt as `options.runAttempt ?? env.GITHUB_RUN_ATTEMPT ?? '1'`. `test/ci-phase-build.test.ts > the lock phase > publishes the trusted facts of a claim` pins neither, so on a GitHub runner's "re-run failed jobs" (attempt 2) it gets `...-attempt-2` and fails. Every CI re-run of `verify` fails there, so a flake can only be cleared by a fresh run.

Make every CI-phase test hermetic with respect to the ambient GitHub Actions env: pin `runAttempt` (or run the phase with an env that drops `GITHUB_RUN_ATTEMPT` / `GITHUB_RUN_ID` and any other `GITHUB_*` value the phase reads), across `ci-phase-build`, `ci-phase-intake`, `ci-phase-treeless`, `ci-phase-tasking` and `ci-agent-result` tests.

## Acceptance criteria

- [ ] The ci-phase tests pass with `GITHUB_RUN_ATTEMPT=2` (and `GITHUB_RUN_ID`, `GITHUB_REPOSITORY` set to arbitrary values) in the environment: demonstrate by a test or a documented run in Decisions (e.g. `GITHUB_RUN_ATTEMPT=2 pnpm --filter dorfl exec vitest run test/ci-phase`).
- [ ] The fix is at the tests (or a shared test helper), not by changing the product's env precedence.
- [ ] The observation is marked resolved.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: no CI-phase test depends on the `GITHUB_*` env of the runner it happens to run on. Read the observation named above, `ci-phase-build.ts` / `ci-phase-intake.ts` (the `runAttempt` fallback), `ci-agent-result.ts`, and the ci-phase test files and helpers. Prefer one shared helper that strips ambient `GITHUB_*` values from the env each phase test uses.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED). If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). The task body lives in `work/tasks/backlog/` (a deliberate drive-from-staging build).
>
> RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles. Never read or write the real `~/.dorfl`, `~/.pi` or other real home state from tests: isolate it to a scratch dir.
