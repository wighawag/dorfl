<!-- dorfl-sidecar: item=observation:test-comments-cite-renamed-sliceablePrds-symbol-2026-06-23 type=observation slug=test-comments-cite-renamed-sliceablePrds-symbol-2026-06-23 allAnswered=false -->

## Q1

**This observation proposed a comment/describe-name sweep of `sliceablePrds` -> `taskableBriefs` across test/scan.test.ts, test/select-priority.test.ts, and test/mirror-pool-scan.test.ts. That sweep is now ALREADY DONE (the symbol landed as `taskablePrds`, and all cited test sites use it with `taskable` prose). What should become of this signal: delete it as resolved/stale, or keep it for some residual you still see?**

> Verified against current reality on 2026-06-25:
> - src symbol: packages/dorfl/src/select-priority.ts:111 now exports `taskablePrds` (NOT `sliceablePrds`, and NOT the `taskableBriefs` this observation predicted).
> - A repo-wide grep over packages/dorfl/test/ for `sliceablePrds`, `sliceable PRD/Prd`, and `taskableBriefs` returns ZERO matches (exit 1).
> - Every site this observation flagged already cites the new name: scan.test.ts:396 'REUSES `taskablePrds` (the SAME `autoslice-gate` predicate...)'; select-priority.test.ts:54 describe('taskablePrds — consumes autoslice-gate predicate ...'); mirror-pool-scan.test.ts:21,26,184 all say `taskablePrds`/'taskable PRDs'; do-autopick.test.ts:294 describe('PRD pool eligibility is autoslice-gate ...').
> - The only surviving `sliceablePrds` strings live in immutable historical records under work/tasks/done/* and in other observation notes (e.g. work/notes/observations/review-nits-...-2026-06-23.md) — not in any live test comment, and not in scope of this comment-sweep observation.
> - The immutable slug `autoslice-gate` is preserved verbatim, as the observation required.
> Net: the sweep this observation requested was carried out by the `rename-slicing-modules-and-symbols-to-tasking` task (to the `taskable`/`task` family). The observation's premise ('TEST comments still cite the renamed `sliceablePrds`') no longer holds.

_Suggested default: Delete it: the proposed comment/describe-name sweep is already complete in the live test tree (no `sliceablePrds`/`taskableBriefs` remains in packages/dorfl/test/), so there is no residual task to promote. (Note: the symbol landed as `taskablePrds`, not the `taskableBriefs` this observation anticipated.)_

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
