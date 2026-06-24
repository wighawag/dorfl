<!-- dorfl-sidecar: item=observation:review-nits-rename-residual-slice-test-labels-and-skill-provenance-2026-06-23 type=observation slug=review-nits-rename-residual-slice-test-labels-and-skill-provenance-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation — the three non-blocking nits the Gate-2 review of 'rename-residual-slice-test-labels-and-skill-provenance' raised (a partial-rename wart in test/close-job.test.ts describe + sibling it-blocks, a stale `sliceablePrds` comment in test/scan.test.ts:396 that is part of a broader comment-cluster across select-priority.test.ts/mirror-pool-scan.test.ts/do-autopick.test.ts, and the noted absence of a `## Decisions` block on the PR)?**

> The observation file (work/notes/observations/review-nits-rename-residual-slice-test-labels-and-skill-provenance-2026-06-23.md) records three findings from an APPROVED Gate-2 review:
>   1. test/close-job.test.ts: the renamed first it-block (~L115-140 uses `my-brief`/'closes the brief's issue…') sits in a describe (L114 'runCloseJob — the PRD case') whose other it-blocks and fixtures (L140-143, L159-160, L210-211, L233) still read `my-prd`/`prd:<slug> slice`/'PRD'. Within the task's literal line-scoping; coherence wart only.
>   2. test/scan.test.ts:396 — JSDoc still says 'REUSES `sliceablePrds` (the SAME `autoslice-gate` predicate…)' though the live src symbol is now `taskableBriefs` (packages/dorfl/src/select-priority.ts:111). Identical stale citations live in select-priority.test.ts:54, mirror-pool-scan.test.ts, do-autopick.test.ts:294 — a broader residual cluster, not unique to this slice.
>   3. PR/commit body has no `## Decisions` block; reviewer notes nothing was hidden beyond the scoping calls already flagged.
> Reality check: no follow-up task in work/tasks/{backlog,todo}/ currently captures a 'sliceablePrds → taskableBriefs comment/test-vocabulary sweep'; the prior renames landed in work/tasks/done/rename-slicing-modules-and-symbols-to-tasking.md and work/tasks/done/rename-residual-slice-test-labels-and-skill-provenance.md but neither swept these comment/describe residuals. The original slice is APPROVED and integrating — these are durable nits, not blockers.

_Suggested default: promote-task — open ONE small follow-up sweep task covering both (a) finishing the `runCloseJob — the PRD case` describe rename in test/close-job.test.ts (header + sibling it-blocks + fixtures L140-233) and (b) the broader `sliceablePrds`/`autoslice-gate`/`prd:<slug> slice` → `taskableBriefs`/brief-vocabulary comment sweep across test/scan.test.ts:396, select-priority.test.ts:54, mirror-pool-scan.test.ts, do-autopick.test.ts:294 (comments/JSDoc only; no src/ behaviour change). The Decisions-block nit is informational and needs no task._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
