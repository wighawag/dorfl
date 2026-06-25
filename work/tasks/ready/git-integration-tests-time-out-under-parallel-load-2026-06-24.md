---
title: Raise testTimeout (or cap parallelism) for git-heavy integration tests
slug: git-integration-tests-time-out-under-parallel-load-2026-06-24
needsAnswers: false
blockedBy: []
---

## What to build

Stop the git-heavy integration tests from flaking under parallel CI load. During
a full `pnpm -r test` run (~230s wall, ~765s cumulative), two git-heavy tests
failed with `Test timed out in 5000ms`:
`packages/dorfl/test/complete-self-renaming-folder-task.test.ts:160`
(DIRTY-CONTINUE) and `packages/dorfl/test/do-isolated.test.ts:445`
(SEQUENTIAL-REFETCH FRESHNESS drain). Re-running just those two files in
isolation passes (17/17) in ~5s — so it is parallel-load CPU starvation of the
default 5000ms per-test timeout, not a logic defect.

The fix is one of: raise the per-test `testTimeout` on these git-integration test
files (or their vitest project) to a value comfortable under loaded CI, OR cap
the suite's pool size so the git-heavy files do not contend. See the open
question for which.

## Acceptance criteria

- [ ] The two named tests (and any sibling git-heavy integration tests) no longer
      time out under full `pnpm -r test` on a loaded box.
- [ ] The chosen mechanism (raised `testTimeout` vs capped parallelism) is applied
      narrowly to the git-heavy tests/project, not blanket-loosened across the
      whole suite.
- [ ] No logic change to the tests themselves; they still assert the same
      behaviour.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately.

## Open questions

1. Should these git-integration tests carry a higher per-test `testTimeout`, or
   should the suite cap parallelism, so a loaded CI box does not flake them?

## Prompt

> Goal: eliminate the parallel-load timeout flake in the git-heavy integration
> tests. Root cause (verified): under full `pnpm -r test` the default 5000ms
> per-test timeout is exceeded by CPU starvation, not a logic bug — the same
> tests pass in isolation in ~5s.
>
> Where to look: `packages/dorfl/test/complete-self-renaming-folder-task.test.ts`
> (the DIRTY-CONTINUE case ~L160) and `packages/dorfl/test/do-isolated.test.ts`
> (SEQUENTIAL-REFETCH FRESHNESS ~L445), plus the vitest config governing their
> project/pool. Identify the set of git-heavy integration tests that share this
> exposure (they shell out to git repeatedly).
>
> FIRST resolve the open question (it is `needsAnswers: true`): raise `testTimeout`
> on these files/project to a value comfortable under loaded CI, OR cap the pool
> size for the git-heavy project. Prefer the narrowest fix that does not loosen
> the timeout for the whole suite (a blanket bump hides real regressions). Record
> the choice + rationale in a `## Decisions` note.
>
> Done = the named tests stop timing out under full `pnpm -r test` on a loaded
> box, the change is scoped to the git-heavy tests, and the gate is green.

## Applied answers 2026-06-25

### q1: How should these two flaky-under-parallel git tests be fixed: raise their per-test testTimeout, cap suite parallelism, OR add them to the existing RACE_SENSITIVE list so they run in the already-defined non-file-parallel `sequential` vitest project?

Use the THIRD option: add `test/complete-self-renaming-folder-task.test.ts` and `test/do-isolated.test.ts` to the existing `RACE_SENSITIVE` array in `packages/dorfl/vitest.config.ts` so they run in the already-defined non-file-parallel `sequential` project. Do NOT raise `testTimeout` and do NOT cap global parallelism. Reason: both files are squarely in the documented git-`file://`/`--bare`-arbiter class (`seedRepoWithArbiter`, `performComplete`/`performClaim`, `performDoRemote(Auto)`, writing main) that the `sequential` project exists to isolate; they were simply missed from the list. This is the repo's already-chosen, documented remedy ("without slowing the whole suite or masking anything with retries"), it keeps the fast pure-logic tests fully parallel, and it avoids a `testTimeout` bump that would only widen a window that hides real future regressions. Add a short comment next to the two new entries explaining the class (mirroring the existing entries, e.g. do-remote.test.ts), and record the choice + rationale in a `## Decisions` note as the task prompt asks.

### q2: The task's `## What to build` section is empty while `needsAnswers: true`. Should the build scope be exactly 'move the two named test files into the non-file-parallel project (or whichever remedy is chosen above)', or is a broader audit intended (e.g. sweeping all remaining git-heavy tests not yet in RACE_SENSITIVE)?

Scope it MINIMALLY: only the two named files (`complete-self-renaming-folder-task.test.ts` and `do-isolated.test.ts`), via the remedy in Q1. No logic change to the tests; no broader sweep. If a wider audit of git-heavy tests not yet in `RACE_SENSITIVE` is warranted, file it as a SEPARATE follow-up task rather than expanding this one.
