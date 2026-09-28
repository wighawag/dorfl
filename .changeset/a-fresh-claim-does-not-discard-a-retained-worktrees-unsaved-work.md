---
'dorfl': patch
---

A fresh claim no longer silently discards a retained job worktree's unsaved work. When `createJob` would cut a fresh work branch over a leftover `<workspacesDir>/work/<work-id>/` worktree (a crashed run whose lock was released some way other than `requeue`, e.g. `release-lock`), it now applies the same deletion-safety check `gc` uses; if the worktree has uncommitted changes or commits the arbiter lacks, the claim is refused with the path and the recovery (`dorfl requeue <slug>` saves the work so the next claim continues from it) and the worktree is left untouched. A retained worktree with nothing local-only is still cleared as before.
