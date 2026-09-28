---
title: 'createJob fresh cut clears a retained worktree with unsaved work'
slug: createjob-fresh-cut-clears-a-retained-worktree-with-unsaved-work
date: 2026-09-28
status: resolved
resolvedDate: 2026-09-28
---

> RESOLVED 2026-09-28 by task `a-fresh-claim-does-not-discard-a-retained-worktrees-unsaved-work`: before `clearStale`, `createJob`'s fresh-cut path now applies the shared gc deletion-safety predicate (`evaluateDeletionSafety`) to a retained job worktree at the work-id. If the worktree holds work the arbiter lacks (dirty tree, or a tip neither merged nor pushed), `createJob` throws `RetainedWorktreeUnsavedWorkError` naming the path and the recovery (`dorfl requeue <slug>` saves it and the next claim continues from it), and leaves the worktree and its branch untouched; `do --isolated` skips its post-throw leak reap for that error. A provably-safe retained worktree is still cleared as before.

2026-09-28: `createJob`'s FRESH-cut path (`packages/dorfl/src/workspace.ts`, `clearStale` → `forceClearWorktreePath` + `pruneAndDropBranch`) removes a leftover `<workspacesDir>/work/<work-id>/` worktree and deletes its local `work/task-<slug>` branch without applying the gc deletion-safety predicate, so a retained crashed-run worktree with unpushed commits is discarded by the next claim whenever the lock was released some other way than `requeue` (e.g. `release-lock task:<slug>`). `requeue` now saves such work first (task `a-crashed-runs-local-work-is-saved-before-its-lock-is-released`), but the claim-time clear itself is still unguarded.
