<!-- dorfl-sidecar: item=task:apply-resolve-reset-flag-discards-work-branch type=task slug=apply-resolve-reset-flag-discards-work-branch allAnswered=false -->

## Q1

**'task:apply-resolve-reset-flag-discards-work-branch' was bounced — how should we proceed?**

> agent failed: Anthropic stream ended before message_stop

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):

Resolve, and RESET (rebuild fresh). This bounce was a TRANSIENT infrastructure failure, NOT a defect: the Anthropic API stream dropped mid-run (`stream ended before message_stop`) while the agent was still in the read/investigate phase, before it made any edits. So there is no partial work to keep and no saved branch to continue from — reset is trivially correct (nothing to discard). Just re-pool it for a fresh build attempt.

The rebuild guidance from the prior resolve still holds in full (the task body + re-scope carry it): keep the correct mechanism shape (`resolveReset?: boolean` on `DecisionVerdict` + its parser; the shared `deleteRemoteWorkBranchIfPresent` primitive), thread `verdict.resolveReset` AND `arbiter` through the REAL `resolve` dispatch site in `advance.ts` (~line 1498, which today calls `apply({cwd, item, itemPath, note})` with neither), add an END-TO-END test through the rung dispatcher, record the delete-first ordering in a `## Decisions` block linked from the done record, and address the branch-delete-failure refusal shape. Do NOT widen the observation-only `runAgenticDecision` gate.

Note (transient re-surface): this is the SECOND non-content bounce of this item (Gate-2 block, then this stream drop). If a THIRD transient failure re-surfaces it, that is a flakiness signal worth capturing rather than just re-answering — the build has not yet reached the edit phase on its own merits.
