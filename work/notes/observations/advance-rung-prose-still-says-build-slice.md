---
needsAnswers: true
---

# 2026-06-23: advance-RUNG prose still spelled `build/slice` (not the pool keyword)

While renaming the `SelectionPool` keyword `slice`->`task`
(`rename-selection-pool-slice-keyword-to-task`), I noticed JSDoc/comment prose in
`advance-treeless-publish.ts` (~L168 "The build/slice rungs are NOT here") and
several advance tests (`advance.test.ts`, `advancing-lock.test.ts`,
`advance-registry-set.test.ts`, `advance-in-place-publishes-treeless-results.test.ts`,
`advance-isolated.test.ts`, etc.) still call the advance rungs "build/slice". The
RUNG tokens themselves were already renamed `build-slice`->`build-task` /
`task-brief` (see `advance-classify.ts`), so this is residual doc-vs-code prose
drift on the ADVANCE-RUNG surface, distinct from the selection-pool keyword this
task owns. Left untouched (out of scope); flag for the advance-rung prose sweep.
