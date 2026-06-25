---
title: Raise testTimeout (or cap parallelism) for git-heavy integration tests
slug: git-integration-tests-time-out-under-parallel-load-2026-06-24
needsAnswers: true
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
