<!-- dorfl-sidecar: item=task:git-integration-tests-time-out-under-parallel-load-2026-06-24 type=task slug=git-integration-tests-time-out-under-parallel-load-2026-06-24 allAnswered=false -->

## Q1

**How should these two flaky-under-parallel git tests be fixed: raise their per-test testTimeout, cap suite parallelism, OR add them to the existing RACE_SENSITIVE list so they run in the already-defined non-file-parallel `sequential` vitest project?**

> The task's own Open question offers only two options (higher per-test testTimeout vs cap parallelism). But packages/dorfl/vitest.config.ts already implements a THIRD, established remedy for exactly this symptom: a RACE_SENSITIVE array (lines 24+) listing git-heavy/timing-sensitive files that run in a separate `sequential` project with `fileParallelism: false`, precisely 'without slowing the whole suite or masking anything with retries' (config header comment). The two failing files named here, test/complete-self-renaming-folder-task.test.ts and test/do-isolated.test.ts, are NOT currently in that list (grep: no match), so the task author may not have noticed the convention already in place. No testTimeout override exists anywhere in packages/dorfl (grep: no match), so the suite runs on vitest's default 5000ms. The choice matters because a global testTimeout bump or a parallelism cap would diverge from the repo's documented approach and either slow the whole suite or mask real regressions.

_Suggested default: Add test/complete-self-renaming-folder-task.test.ts and test/do-isolated.test.ts to the existing RACE_SENSITIVE list (the repo's already-chosen pattern for this exact file-parallel CPU-starvation class), rather than raising testTimeout or capping global parallelism._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Use the THIRD option: add `test/complete-self-renaming-folder-task.test.ts` and `test/do-isolated.test.ts` to the existing `RACE_SENSITIVE` array in `packages/dorfl/vitest.config.ts` so they run in the already-defined non-file-parallel `sequential` project. Do NOT raise `testTimeout` and do NOT cap global parallelism. Reason: both files are squarely in the documented git-`file://`/`--bare`-arbiter class (`seedRepoWithArbiter`, `performComplete`/`performClaim`, `performDoRemote(Auto)`, writing main) that the `sequential` project exists to isolate; they were simply missed from the list. This is the repo's already-chosen, documented remedy ("without slowing the whole suite or masking anything with retries"), it keeps the fast pure-logic tests fully parallel, and it avoids a `testTimeout` bump that would only widen a window that hides real future regressions. Add a short comment next to the two new entries explaining the class (mirroring the existing entries, e.g. do-remote.test.ts), and record the choice + rationale in a `## Decisions` note as the task prompt asks.

## Q2

**The task's `## What to build` section is empty while `needsAnswers: true`. Should the build scope be exactly 'move the two named test files into the non-file-parallel project (or whichever remedy is chosen above)', or is a broader audit intended (e.g. sweeping all remaining git-heavy tests not yet in RACE_SENSITIVE)?**

> work/tasks/ready/git-integration-tests-time-out-under-parallel-load-2026-06-24.md has a heading `## What to build` with no content; only `## What was seen` and `## Open questions` are filled. Per the work contract a task's prompt should be self-contained enough for an agent to start from the file alone. Without a stated build scope, an agent could either make the minimal two-file change or expand into a broader parallelism-hardening sweep.

_Suggested default: Scope it minimally: only the two files observed to time out (complete-self-renaming-folder-task.test.ts:160 and do-isolated.test.ts:445), via the remedy chosen above; defer any broader audit to a separate task._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Scope it MINIMALLY: only the two named files (`complete-self-renaming-folder-task.test.ts` and `do-isolated.test.ts`), via the remedy in Q1. No logic change to the tests; no broader sweep. If a wider audit of git-heavy tests not yet in `RACE_SENSITIVE` is warranted, file it as a SEPARATE follow-up task rather than expanding this one.
