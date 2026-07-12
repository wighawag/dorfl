<!-- dorfl-sidecar: item=observation:prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch type=observation slug=prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch allAnswered=false -->

Item: [`observation:prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch`](../notes/observations/prd-to-spec-verb-dispatch-belongs-with-do-ts-batch-not-the-namespace-batch.md)

## Q1

**What becomes of this observation — should the general lesson (a clause belongs in the batch that owns the file it edits; add a file-ownership lens to review for wide-refactor chains) be captured as an ADR or as a review-protocol addition, or is the concrete fix (moving the verb-dispatch clause into batch 4) enough that this note can be dropped?**

> The concrete boundary miss is already resolved: batch 2 (rename-spec-frontmatter-field-and-slug-namespace.md) was narrowed and explicitly marks the verb-dispatch as NON-SCOPE, and batch 4c (rename-spec-remaining-src-modules-c.md) landed the do spec:/advance spec: dispatch at do.ts:711/1893 + advance.ts peers — both tasks are in work/tasks/done/. What remains open is the META lesson the observation names: reviewers of wide-refactor chains missed a file-ownership check (per-clause: which file must change, does this batch own it?). That is a general improvement to the review lens, not a code fix.

_Suggested default: Drop the observation after distilling one line into REVIEW-PROTOCOL.md (or a small ADR on wide-refactor batch decomposition) recording the file-ownership lens: for each acceptance clause, name the file it must edit and confirm the batch owns it. If the maintainer thinks the concrete fix is sufficient signal, just delete._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Capture the general lesson ('a clause belongs in the batch that owns the file it edits; add a file-ownership lens to review for wide-refactor chains') as a one-line addition to REVIEW-PROTOCOL.md's lens list (same home as the expand-first lens), then delete. The concrete fix (moving the verb-dispatch clause into batch 4) has landed, so nothing else remains; no standalone ADR needed.
