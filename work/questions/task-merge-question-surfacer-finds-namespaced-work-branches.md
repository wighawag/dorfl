<!-- dorfl-sidecar: item=task:merge-question-surfacer-finds-namespaced-work-branches type=task slug=merge-question-surfacer-finds-namespaced-work-branches allAnswered=false -->

## Q1

**'task:merge-question-surfacer-finds-namespaced-work-branches' was bounced — how should we proceed?**

> continuing the kept work/task-merge-question-surfacer-finds-namespaced-work-branches: rebase onto the latest main conflicted (aborted, never auto-resolved) — run `requeue --reconcile` to non-destructively re-sync the mirror and retry the rebase (keeps the work). Last resort: `requeue --reset` DESTRUCTIVELY discards the branch and starts fresh.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):

reset (the kept branch cannot rebase: its Decisions and the applied keep answer both append to the task body; rebuild from scratch, human-approved)
