---
title: 'A fresh claim does not discard a retained worktree'"'"'s unsaved work'
slug: a-fresh-claim-does-not-discard-a-retained-worktrees-unsaved-work
blockedBy: []
---

## What to build

Observation `createjob-fresh-cut-clears-a-retained-worktree-with-unsaved-work`: `createJob`'s fresh-cut path in `workspace.ts` (`clearStale` → `forceClearWorktreePath` + `pruneAndDropBranch`) removes a leftover `<workspacesDir>/work/<work-id>/` worktree and deletes its local `work/task-<slug>` branch without the gc deletion-safety predicate. So a crashed run's retained worktree with uncommitted changes or unpushed commits is silently discarded by the next claim whenever the lock was released by something other than `requeue` (for example `release-lock task:<slug>`). `requeue` saves such work first (#433), but the claim-time clear itself is unguarded.

Before clearing, apply the same "is there local-only work here?" check `gc` and the #433 requeue save use. If there is, do not destroy it: either save it to the arbiter work branch the way requeue does (so the claim continues from it), or refuse the claim loudly with the path and the recovery command. Choose and record which in Decisions; prefer reusing the #433 save if it is safe at claim time.

## Acceptance criteria

- [ ] A fresh claim over a retained worktree with uncommitted changes does not lose them (tested: the changes survive, either on the pushed work branch or in the untouched worktree with a clear refusal).
- [ ] Same for unpushed local commits on the retained branch (tested).
- [ ] A retained worktree with nothing local-only is still cleared as today (tested; no behaviour change for the common case).
- [ ] The deletion-safety check is shared with `gc` / the requeue save, not a third copy.
- [ ] The observation is marked resolved.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: no dorfl verb silently destroys local-only work in a retained worktree. Read the observation named above, `workspace.ts` (`createJob`, `clearStale`, `forceClearWorktreePath`, `pruneAndDropBranch`), `gc`'s deletion-safety predicate, and the done task `a-crashed-runs-local-work-is-saved-before-its-lock-is-released` (the requeue save). Tests use throwaway repos and a scratch workspaces dir.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED). If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). The task body lives in `work/tasks/backlog/` (a deliberate drive-from-staging build).
>
> RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles. Never read or write the real `~/.dorfl`, `~/.pi` or other real home state from tests: isolate it to a scratch dir.

## Decisions

- **Refuse instead of saving at claim time.** When a retained worktree holds local-only work, `createJob` throws `RetainedWorktreeUnsavedWorkError` and leaves the worktree alone. Reasons:
  - Reusing the requeue save would have meant making `createJob` async, which touches `isolation.ts` `prepare`, `run`, `do` and both merge-action paths.
  - An automatic save could bring back work a human had discarded with `requeue --reset`, which deletes only the remote branch and leaves the worktree in place.
  - The refusal names `dorfl requeue <slug>`, which already does the save, and the refused claim holds the lock that requeue needs.

  The alternative was an automatic save and continue. This adds a new failure mode for any `createJob` caller (`do --isolated`, `run`, `apply-merge-action`), which then shows up as a claim failure while the lock is still held.
- **`do --isolated` skips its post-throw cleanup for this error.** That cleanup only checks whether the branch tip is on the arbiter, so it would delete a dirty worktree whose tip is already on main. This touches only the `do --isolated` failure path.
- **The check runs only on git worktrees.** Orphan directories and dangling symlinks keep today's self-heal removal, since they hold no work git knows about.
- **Only the fresh-cut path is guarded.** The continue path has the same gap, but the task scoped this to the fresh cut, so I recorded it as an observation instead.
