<!-- dorfl-sidecar: item=observation:review-nits-reconcile-stale-needs-attention-folder-prose-after-lock-cutover-2026-07-10 type=observation slug=review-nits-reconcile-stale-needs-attention-folder-prose-after-lock-cutover-2026-07-10 allAnswered=false -->

Item: [`observation:review-nits-reconcile-stale-needs-attention-folder-prose-after-lock-cutover-2026-07-10`](../notes/observations/review-nits-reconcile-stale-needs-attention-folder-prose-after-lock-cutover-2026-07-10.md)

## Q1

**All three code-drift nits are already resolved on disk — should this observation be deleted rather than promoted?**

> grep for 'to work/needs-attention' across packages/dorfl/src returns nothing (the three cited docstrings in tasking.ts:1125/:1144, tasker-review-loop.ts:78, failure-cause.ts:5 no longer contain the stale phrase), and the stale test example 'surfaced to work/needs-attention/ on' is gone from packages/dorfl/test/work-layout-guard.test.ts. A later sweep has evidently absorbed nits 1 and 2, so keeping the observation open only preserves nit 3 (missing Decisions block on ef912302).

_Suggested default: Delete — nits 1+2 are code-obsolete; nit 3 (ratify the 'marked stuck on its per-item lock (...); requeue once resolved' phrasing as canonical) is a one-line human ratification not worth a task._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete. All three code-drift nits are resolved on disk (grep for 'to work/needs-attention' across packages/dorfl/src returns nothing, and the stale test example is gone). Nits 1+2 are code-obsolete; nit 3 is a one-line human ratification not worth a task.

## Q2

**If retained, should nit 3 be promoted to a tiny task that records the canonical replacement wording for the retired 'routed to work/needs-attention/' idiom in an ADR / decisions note?**

> Nit 3 is the only surviving item: the reviewer flagged no Decisions block on the PR and asked a human to ratify the standardised wording (already mirrored from #243 in do.ts) as the canonical replacement idiom across integration-core.ts, complete.ts, start.ts, ledger-write.ts. Without a durable decision record the phrasing is only enforced by grep-and-copy.

_Suggested default: No — the wording is already consistent across all four sites and mirrors an established #243 precedent; a lightweight ADR note is optional, not required._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

No. The replacement wording is already consistent across all four sites (integration-core.ts, complete.ts, start.ts, ledger-write.ts) and mirrors the established #243 precedent from do.ts, so a tiny task recording it in an ADR/decisions note is optional, not required. Discharge nit 3 without a follow-up task.
