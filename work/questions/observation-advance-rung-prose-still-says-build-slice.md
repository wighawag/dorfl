<!-- dorfl-sidecar: item=observation:advance-rung-prose-still-says-build-slice type=observation slug=advance-rung-prose-still-says-build-slice allAnswered=false -->

## Q1

**What becomes of this observation — promote it to a dedicated prose-sweep task that renames the residual `build/slice` advance-rung prose to the current rung tokens (`build-task` / `task-brief`) across `packages/dorfl/src/` and `packages/dorfl/test/`, or keep/drop it?**

> The observation (`work/notes/observations/advance-rung-prose-still-says-build-slice.md`) flags that the ADVANCE-RUNG token rename (`build-slice`->`build-task`, `task-brief` — see `advance-classify.ts`) was completed in code, but JSDoc/comment prose on the SAME advance-rung surface was left calling them `build/slice`. A current grep confirms the drift is real and broad: `packages/dorfl/src/advance-treeless-publish.ts:168` (`The build/slice rungs are NOT here …`) plus ~20+ hits across advance/lock/lifecycle/do tests (`advance-registry-set.test.ts`, `advancing-acquires-unified-lock.test.ts`, `advancing-lock.test.ts`, `advance-isolated.test.ts`, `advance-in-place-publishes-treeless-results.test.ts`, `advance.test.ts`, `advance-lifecycle-template.test.ts`, `advance-autopick-lifecycle-pools.test.ts`, `advance-loop-run-wiring.test.ts`, `run-uses-advance-tick.test.ts`, `intake-trigger-template.test.ts`, `close-job-template.test.ts`, `release-lock-and-gc-stuck-report.test.ts`, `do.test.ts`, `do-remote.test.ts`). The observation explicitly says this was out-of-scope for its originating task (`rename-selection-pool-slice-keyword-to-task`, a SelectionPool keyword rename) and asked for it to be flagged for the advance-rung prose sweep — i.e. it is a real, scoped follow-up, not a duplicate of the pool-keyword rename and not already in flight in any task this surface could see.

_Suggested default: promote-task: a small, mechanical prose-sweep task `rename-advance-rung-prose-build-slice-to-build-task` that renames `build/slice` -> `build-task` (and, where the context refers to the task->brief rung, `task-brief`) in JSDoc and comments across `packages/dorfl/src/` and `packages/dorfl/test/`, with no behavioural change and the existing `pnpm -r build && pnpm -r test && pnpm format:check` as the verify gate._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
