---
'dorfl': patch
---

`requeue <slug>` no longer loses a killed run's local-only work. When the item's lock is held and a dead `do --isolated` run left its retained job worktree with commits (or uncommitted files) the arbiter's `work/task-<slug>` lacks, requeue first commits the residue as the usual wip commit and pushes the branch (plain push, never `--force`, the same save half a needs-attention bounce uses), so the next claim continues from it. If that save fails (e.g. the arbiter branch diverged, or the worktree is mid-rebase), the lock and the worktree are kept and requeue explains why. A live run's worktree is never touched, and `--reset` still discards by design. `gc` now also tells you how to save a retained task worktree (`dorfl requeue <slug>` while its lock is held, else push the branch by hand).
