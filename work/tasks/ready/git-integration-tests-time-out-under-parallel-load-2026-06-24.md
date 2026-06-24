---
title: git-integration-tests-time-out-under-parallel-load-2026-06-24
slug: git-integration-tests-time-out-under-parallel-load-2026-06-24
needsAnswers: true
blockedBy: []
---

## What to build

## What was seen

During a full `pnpm -r test` run (≈230s, 765s cumulative test time), two
git-heavy tests failed with `Test timed out in 5000ms`:
`packages/dorfl/test/complete-self-renaming-folder-task.test.ts:160`
(DIRTY-CONTINUE …) and `packages/dorfl/test/do-isolated.test.ts:445`
(SEQUENTIAL-REFETCH FRESHNESS drain). Re-running just those two files in
isolation passes (17/17) in ≈5s, so it is parallel-load CPU starvation of the
default 5000ms per-test timeout, not a logic defect. Unrelated to the
surface/triage disposition-vocabulary change made in this task.

## Open questions

1. Should these git-integration tests carry a higher per-test `testTimeout`, or
   should the suite cap parallelism, so a loaded CI box does not flake them?
