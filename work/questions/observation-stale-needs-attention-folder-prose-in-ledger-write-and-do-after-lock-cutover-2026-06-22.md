<!-- dorfl-sidecar: item=observation:stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22 type=observation slug=stale-needs-attention-folder-prose-in-ledger-write-and-do-after-lock-cutover-2026-06-22 allAnswered=false -->

## Q1

**What should become of this signal: mint a small follow-up cleanup task to reconcile the stale `work/needs-attention/` folder-move prose, fold it into an existing/upcoming task, or drop it as not worth the churn?**

> Untriaged observation (needsAnswers: true, no `## Open questions` body block) whose claim is CORROBORATED against current reality: the `work/needs-attention/` folder no longer exists and the move behavior is retired (the `ledger-write.ts` strategy delegates to `routeToNeedsAttention`, which now records the reason on the per-item lock `state: stuck` rather than doing a `git mv`). Yet the cited files still describe the retired folder-move as live. The occurrences split into two tiers:
>  - Cosmetic docstrings/comments: `ledger-write.ts:162/326/635/698`, `integration-core.ts:314/575/696/770/...`, `complete.ts:45/93/307/...`, `slicer-review-loop.ts:62`, `slicing.ts:1086/1105`.
>  - HIGHER-VALUE human-facing runtime strings that point users at a folder that no longer exists: `do.ts:1432/1434/1547/1550/2432/2434` ("routed it to work/needs-attention/ ...") and `cli.ts:3207` (the `requeue` help text says it recovers a task from `work/needs-attention/<slug>.md`).
>  No existing `work/tasks/` item addresses this prose reconcile (checked). This deferral was already RATIFIED as a follow-up: the sibling nit `review-nits-remove-dead-needs-attention-folder-readers-after-lock-cutover-2026-06-22.md` explicitly deferred "the residual folder prose" to a follow-up slice, named THIS observation as its home, and that finding was answered "keep / ratify".

_Suggested default: Mint a small follow-up cleanup task scoped to reconcile the prose, prioritising the human-facing runtime strings in `do.ts` and the `cli.ts` requeue help (which actively mislead users) over the pure docstring/comment drift. The deferral to a follow-up was already ratified, no task exists yet, and the change is low-risk text-only._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Mint a small text-only cleanup task to reconcile the stale `work/needs-attention/` prose, prioritising the human-facing RUNTIME strings that actively mislead users (do.ts:1432/1434/1547/1550/2432/2434 and the cli.ts:3207 requeue help) over the pure docstring/comment drift. The deferral to a follow-up was already ratified by the sibling nit and no task exists yet; the change is low-risk. Then delete this observation.
