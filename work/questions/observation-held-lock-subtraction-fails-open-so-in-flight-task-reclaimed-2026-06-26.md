<!-- dorfl-sidecar: item=observation:held-lock-subtraction-fails-open-so-in-flight-task-reclaimed-2026-06-26 type=observation slug=held-lock-subtraction-fails-open-so-in-flight-task-reclaimed-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation? The root cause it names (propose mode releasing the per-item lock at PR-open instead of PR-merge) and the fix direction it prescribes (gate release on the durable main move; keep lock held for the open-PR window; reconcile on out-of-band merge) appear to have already landed in packages/dorfl/src/complete.ts — should it be marked resolved and deleted, promoted to a follow-up task for any residual work (e.g. the leaked-locks hygiene gap / runner-layer benign-already-landed empty-diff treatment), or kept open as a durable record?**

> The observation carries a CORRECTION superseding the original fail-open theory: root cause is releaseClaimLockAfterDurableMove firing unconditionally in propose mode. Current complete.ts ~L1050 now computes `durablyOnMain = result.mergedToMain === true || result.alreadyLanded === true` and passes that gate into releaseClaimLockAfterDurableMove; the comment explicitly cites task `propose-keep-lock-until-pr-merge` and describes reconcileItemLockAgainstMain handling out-of-band merges (item-lock.ts L945). No open task/PRD named `propose-keep-lock-until-pr-merge` remains in work/. Two follow-ups the observation flags remain potentially untriaged: (1) auto-sweep for propose-merged leaked locks (currently only `gc --ledger --reap-stale-locks` clears them), (2) runner-layer treating benign already-landed empty-diff as no-op instead of `stuck`.

_Suggested default: Mark RESOLVED and delete the observation — the root fix has landed; file the two remaining follow-ups (leaked-lock auto-sweep, runner benign-empty-diff treatment) as separate observations if not already covered elsewhere._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
