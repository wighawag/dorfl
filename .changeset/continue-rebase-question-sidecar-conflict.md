---
'dorfl': patch
---

Continuing a kept branch after a second failure no longer dead-ends on a conflict in the item's question sidecar. When a continued attempt's gate failed again, its land had already deleted `work/questions/task-<slug>.md` on the branch while the new surface rewrote it on `main`, so the next continue rebase (and `requeue --reconcile`) stopped on a modify/delete conflict and offered only `--reset`. A continue rebase whose conflicts are all question sidecars now resolves them mechanically and carries on: the branch's deletion wins when the branch done-moves the item, unless `main`'s version carries a human answer, in which case (and in every other case) `main`'s version is kept. Any conflict on another file still aborts and surfaces as before. See ADR `continue-rebase-resolves-question-sidecar-conflicts`.
