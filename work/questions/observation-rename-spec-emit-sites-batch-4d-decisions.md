<!-- dorfl-sidecar: item=observation:rename-spec-emit-sites-batch-4d-decisions type=observation slug=rename-spec-emit-sites-batch-4d-decisions allAnswered=false -->

Item: [`observation:rename-spec-emit-sites-batch-4d-decisions`](../notes/observations/rename-spec-emit-sites-batch-4d-decisions.md)

## Q1

**Should the sidecarPathCandidates fallback (spec-<slug>.md → prd-<slug>.md) be extended to the other readers still on sidecarPathFor (apply-decide, apply-persist, sidecar-apply, advance, drop-source, merge-question-surfacer, mint-adr), or does the plan rely on the prd-to-spec migration command converting data before any spec: identity reaches them?**

> §1 of the observation explicitly limited the candidate-list rollout to the two lifecycle-gather readers and flagged: 'If a later batch routes a spec: identity into those readers before the migration converts data, they will need the same candidate list.' Grep confirms those seven modules still call the single-canonical sidecarPathFor; no follow-up task in work/tasks/done addresses this contingency.

_Suggested default: Leave as-is: rely on prd-to-spec migration landing before any spec:-emit path fans out to those readers; extend the candidate list only if a concrete break appears._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Leave as-is. Rely on the prd-to-spec migration command converting data before any spec: identity fans out to the other seven readers (apply-decide, apply-persist, sidecar-apply, advance, drop-source, merge-question-surfacer, mint-adr). Extend the sidecarPathCandidates fallback to them only if a concrete break appears; adding it pre-emptively would spread the transitional fallback wider than needed.

## Q2

**Is the TickRungKind rung-name 'task-spec' (advance-classify.ts) intentionally kept, or does it need its own rung-rename task before the rename-spec contract closes?**

> §5 of the observation deferred this to 'the rung-rename / contract owner' because renaming a TickRungKind ripples into every rung consumer/dispatch/template/test. Grep shows 'task-spec' is still live in advance-classify.ts, advance.ts, advance-isolated.ts, and advancing-lock.ts, and no queued/done task targets it. If the contract task purges internal spec identifiers, this literal is a candidate leak.

_Suggested default: Keep 'task-spec' as an internal rung-name enum value (not a namespace/CLI token) and do not rename in this rename-spec arc._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Keep 'task-spec' as-is. It is an internal TickRungKind enum value (advance-classify.ts and consumers), not a namespace or CLI token, so it does not leak the retired vocabulary to users or on-disk identity. Do not rename it in this rename-spec arc; a rung-rename would ripple into every rung consumer/dispatch/template/test for no external benefit.
