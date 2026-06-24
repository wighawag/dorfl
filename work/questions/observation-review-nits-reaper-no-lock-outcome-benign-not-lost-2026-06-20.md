<!-- dorfl-sidecar: item=observation:review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20 type=observation slug=review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20 allAnswered=false -->

## Q1

**Q2's answer promoted the broadened-`reconcileItemLockAgainstMain` contract to a follow-up slice, and Q4's `delete` disposition for this observation was explicitly CONTINGENT on that slice actually existing so the promote-slice content is not lost. No matching task or brief currently exists in `work/tasks/{backlog,todo}` or `work/briefs/{ready,tasked}` (grep for `reconcileItemLockAgainstMain` / broadened-contract / leased-delete audit returns only the three already-done tasks and this observation). How should this be resolved before the observation is deleted?**

> Body §'Applied answers 2026-06-22':
> - Q2 answer: 'promote-slice, option (ii): DOCUMENT the broadened contract on `reconcileItemLockAgainstMain` and AUDIT non-reaper callers for the `error`→`no-lock` shape change … Disposition: promote-slice.'
> - Q4 answer: 'DELETE … CONTINGENT on Q2\'s follow-up slice actually being created so the promote-slice content is not lost.'
>
> Repo state today (2026-06-22):
> - `ls work/tasks/{backlog,todo}` and `work/briefs/{ready,tasked}` show no slice carrying the Q2 content.
> - `grep -rli reconcileItemLockAgainstMain work/` finds only `work/tasks/done/*` and this observation file.
>
> Until the Q2 slice exists (or the contingency is explicitly waived), the terminal `delete` recommendation at the bottom of the file is premature: deleting now drops the promote-slice content on the floor, which is exactly what the contingency was written to prevent.

_Suggested default: Create the Q2 follow-up slice first (a task or brief that documents the broadened `reconcileItemLockAgainstMain` contract and audits non-reaper callers for the `error`→`no-lock` outcome-shape change), THEN delete this observation. If you instead want to waive the contingency, say so explicitly so the promote-slice content is consciously dropped rather than silently lost._

<!-- q1 fields: id=q1 disposition=needs-attention -->

**Your answer** (write below this line):
