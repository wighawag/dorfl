---
'dorfl': patch
---

The merge-question surfacer now finds the arbiter's task build branches. It reads the slug from the namespaced branch name (`work/task-<slug>`), where it used to take `task-<slug>` as the slug and skip every branch for lack of an item body. In a clone it lists the arbiter's remote-tracking branches and checks them against the arbiter's `main`; in the hub mirror (or a worktree of it) it lists the local heads. Intake and spec branches are not listed.
