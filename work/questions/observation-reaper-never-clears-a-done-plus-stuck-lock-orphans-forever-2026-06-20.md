<!-- dorfl-sidecar: item=observation:reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20 type=observation slug=reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20 allAnswered=false -->

## Q1

**This observation was already dispositioned on 2026-06-22 as promote-slice (contract change: split kept-stuck into stuck+terminal=>reapable vs stuck+in-flight=>keep, with pin test + ADR note), and the 2026-06-28 update re-confirms the auto-reaper carve-out is still unbuilt in code. What becomes of this signal now — mint the promote-slice task and delete this observation, keep it as a still-open observation pending other work, or a different route?**

> needsAnswers: false in front-matter, but the source still sits in work/notes/observations/ with an applied answer and a later re-confirmation. Item-lock.ts reconcileItemLockAgainstMain (~L1004-1014) still returns kept-stuck for terminal+stuck; reapStaleItemLocks (L1392+) still reaps only cleared-stale. Sibling manual-release bug is now fixed; auto-reaper carve-out remains. Related: gc-remote-branches-cannot-reap-squash-merged-work-branch-2026-06-28.

_Suggested default: Mint the promote-slice task per the 2026-06-22 disposition (contract change with carve-out + pin test + ADR note) and delete this observation as discharged._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Mint the task per the 2026-06-22 disposition: change reconcileItemLockAgainstMain's kept-stuck contract to split stuck+terminal-on-main (=> reapable) from stuck+in-flight (=> keep), extend reapStaleItemLocks to reap the terminal-orphan case, with a pin test (terminal-orphan reaped; in-flight retained) and an ADR note recording the contract change. Cross-link the squash-merge sibling `gc-remote-branches-cannot-reap-squash-merged-work-branch` (same orphan problem, lock-side vs branch-side). Then delete this observation.
