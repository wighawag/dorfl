---
'dorfl': patch
---

The CI close-job (`dorfl close-merged-issues`) no longer closes a spec's issue while some of its tasks are still staged. The "is this spec complete?" check now sees every task that names the spec wherever it lives: a task in `work/tasks/backlog/`, `work/tasks/ready/` or in progress keeps the spec open. Before, it skipped `tasks/backlog/`, where tasking stages new tasks by default, so an issue was closed as completed as soon as the first of its tasks merged.

A cancelled task no longer blocks completion: a spec with some tasks done and the rest cancelled closes as before. A spec whose tasks are all cancelled (none done), and a lone task that was cancelled, leave the issue open and report `cancelled` in the close-job log; closing an abandoned issue is left to a human.
