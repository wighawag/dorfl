# 2026-06-06 — pushing the work branch on `run`'s gate-fail bounce makes the worktree REAPABLE

While building `gate-fail-pushes-work-branch`: adding the explicit
`git push <arbiter> work/<slug>` to `run.ts` step 5 (the red-gate bounce)
interacts with end-of-job teardown. The §4 deletion predicate (`reapJob`,
`gc.ts`) reaps a worktree when it is clean AND `<arbiter>/work/<slug>` tip ==
local tip ("pushed"). Pushing the branch on the bounce makes exactly that true,
so the gate-failed job worktree is now REAPED at teardown instead of retained.

This is ADR §4-consistent ("the trigger is provable safety, not 'success' … a
job whose commits are on the arbiter is reaped; one rule, no done-vs-failed
special-casing") — the cross-machine recovery now rides on the PUSHED branch,
not the local worktree. But it supersedes the older "the retained worktree is
the never-lose-work signal" framing for the gate-fail case, so three run.test.ts
assertions that expected RETENTION after a red gate were updated to expect
reaping + a recoverable pushed branch. The rebase-conflict path (run's
integrate-time bounce) was NOT touched by this slice and still retains its
worktree (its branch is not pushed there).
