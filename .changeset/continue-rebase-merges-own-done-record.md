---
'dorfl': patch
---

A kept branch can be continued after its question is answered. When the acceptance gate failed on the rebased tip, the kept branch already held the done-move of `work/tasks/ready/<slug>.md`, while the surface and the answer's apply edited that file on `main`; the next continue rebase (and `requeue --reconcile`) aborted on `work/tasks/done/<slug>.md` every time. A continue rebase whose conflicts are confined to the continued task's own done record (plus question sidecars) now merges it mechanically: `main`'s body (the question and the applied answer) plus the branch's `## Decisions`, at the done path. Any other conflict still aborts. See ADR `continue-rebase-merges-the-tasks-own-done-record`.
