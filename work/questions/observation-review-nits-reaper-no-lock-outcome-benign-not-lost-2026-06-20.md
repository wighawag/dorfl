<!-- dorfl-sidecar: item=observation:review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20 type=observation slug=review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20 allAnswered=false -->

## Q1

**The observation's terminal routing (q4, applied 2026-06-22) is DELETE, but it was made explicitly CONTINGENT: "delete (after Q2's slice exists)" so the q2 promote-slice content is not lost. No such follow-up task exists anywhere in work/ (backlog/, ready/, prds/) as of this surface. Do you want the q2 follow-up slice created first (and only THEN delete this observation), or do you now waive the contingency and delete regardless?**

> Sidecar body: q4 = "DELETE ... CONTINGENT on Q2's follow-up slice actually being created so the promote-slice content is not lost." q2 = "promote-slice, option (ii): DOCUMENT the broadened contract on reconcileItemLockAgainstMain and AUDIT non-reaper callers for the error->no-lock shape change ... the one genuine non-churn item in this sidecar." Searched work/tasks/{backlog,ready} and work/prds for any task capturing that audit (reconcile contract / non-reaper caller / error->no-lock shape change); the only matches are the done reaper task itself and unrelated land-time/rebase tasks. The 'Recommended: delete' footer says a human may now remove the item, but that footer does not carry q4's stated precondition. The broadened-contract code is still live (packages/dorfl/src/item-lock.ts:1038-1046, the remoteEmpty branch returning 'no-lock'), so the q2 audit concern is undischarged, not stale.

_Suggested default: Create the q2 follow-up slice (document reconcileItemLockAgainstMain's broadened shared contract + audit non-reaper callers, e.g. recovery, for the error->no-lock outcome change) BEFORE deleting this observation, since q4 itself conditioned the delete on exactly that, and the code change is still present._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Create the q2 follow-up task FIRST, then delete this observation. Do not waive the contingency: q4's delete was explicitly conditioned on q2's slice existing, and the q2 concern is undischarged, not stale, the broadened `reconcileItemLockAgainstMain` contract (the remoteEmpty branch returning 'no-lock', item-lock.ts:1038-1046) is still live and non-reaper callers (e.g. recovery) have not been audited for the error->no-lock shape change. Mint a small task to document the broadened shared contract and audit non-reaper callers, then delete this observation.
