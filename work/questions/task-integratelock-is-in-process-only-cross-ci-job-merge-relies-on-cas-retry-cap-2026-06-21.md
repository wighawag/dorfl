<!-- dorfl-sidecar: item=task:integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21 type=task slug=integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21 allAnswered=false -->

## Q1

**This task's substance appears to be ALREADY tasked and decomposed under PRD `land-time-reverify-and-parallel-merge-ceiling` (Applied Answer q1). What should become of this item: cancel/drop it as a duplicate, or is there residual scope it still owns that the existing slices do not cover?**

> The task body says only 'draft this into a buildable slice' (it is an empty stub). But the cross-job-merge serialiser decision it was promoted to settle is already RESOLVED in `work/prds/tasked/land-time-reverify-and-parallel-merge-ceiling.md` (Applied Answer q1: scaled `mergeRetries` floor + optional ref-lock accelerator + GitHub `concurrency:` as host sugar only), and that decision is already split into PRD-linked backlog slices:
>  - `work/tasks/backlog/merge-retries-gate-precedence.md` (the scaled CAS-retry floor, covers story 5)
>  - `work/tasks/backlog/cross-job-ref-based-land-lock.md` (the portable accelerator, covers story 5)
>  - `work/tasks/backlog/ci-template-parallel-merge-fanout.md` (the CI fan-out shape, covers stories 4, 6)
>  - `work/tasks/backlog/test-cross-job-concurrent-land.md` + `test-in-process-concurrent-land.md` (covers story 13)
> The observation that produced this task even records the steer 'prefer FOLDING the durable rule into the brief's eventual ADR rather than spinning a standalone one'. So this slug looks like an orphaned duplicate of work already owned elsewhere (review lens 5: orphan + duplicate).

_Suggested default: Drop this task as a duplicate: its substance is fully owned by the `land-time-reverify-and-parallel-merge-ceiling` PRD slices listed above. Discharge via the direct-delete path (remove the task file + any sidecar in one revertible commit)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**The originating premise of this task — that `DEFAULT_MERGE_RETRIES = 5` is too small for a wide CI matrix and may route losers to needs-attention — is STALE against the current code. Does this change the disposition (e.g. is there nothing left to do here), or does any residual concern remain?**

> The observation and the task were framed around `DEFAULT_MERGE_RETRIES = 5` sized for in-process siblings. But `packages/dorfl/src/integration-core.ts:195` now sets `const DEFAULT_MERGE_RETRIES = 1000;`, and the docstring (~L485-496) records that the SEMANTICS changed (task `c2-rebase-until-real-on-durable-main-promotions`): a clean re-rebase no longer counts against the budget — only a genuine conflict stops the loop — so the value is now a LARGE liveness ceiling, not a small contention cap. The 'cap of 5 will spuriously bounce wide matrices' worry the task rests on no longer holds as written (review lens 1: claim-vs-reality drift). The remaining real work (make the cap resolve through the gate-precedence chain) is the separate `merge-retries-gate-precedence` task.

_Suggested default: Treat the premise as superseded by the code (cap is now 1000 with re-rebase no longer charged); fold this into the drop decision above rather than re-scoping it, since the residual 'make the cap configurable' work is already its own slice._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**The task carries `needsAnswers: true` but its body contains NO `## Open questions` block and no inline questions. Is that an authoring error to fix (the gate axis lying), or does the human intend specific open scoping questions that were never written down?**

> Per the work contract, `needsAnswers: true` must reflect real open questions LISTED in the body (REVIEW-PROTOCOL lens 3: gate axes set honestly; a falsely-set gate axis is a defect). The frontmatter sets `needsAnswers: true` and the body says it 'Carries needsAnswers:true so the advance loop surfaces the open scoping questions', yet no such questions are present. The task also omits `prd`/`covers` even though the work belongs to the tasked PRD `land-time-reverify-and-parallel-merge-ceiling`.

_Suggested default: If the item is dropped as a duplicate (Q1), this is moot. If it is kept, the open scoping questions are exactly the cross-job-serialiser questions ALREADY answered in PRD Applied Answer q1, so clear `needsAnswers` and link `prd`/`covers` rather than re-asking._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
