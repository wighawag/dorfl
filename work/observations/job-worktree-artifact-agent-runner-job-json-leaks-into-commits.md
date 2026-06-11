---
title: the job-worktree runtime file `.agent-runner-job.json` is NOT gitignored, so an isolated build (`do --remote`/`--isolated`/`run`) can COMMIT it onto the work branch — polluting the repo and (worse) wedging the continue-rebase recovery path
date: 2026-06-11
status: open
---

## The signal

A `do --remote` / job-worktree build writes a runtime descriptor `.agent-runner-job.json` at the worktree root (slug, repoKey, branch, startedAt, state, harness adapter — the liveness/recovery anchor). That file is NOT in `.gitignore`. Twice in one drive-backlog session an isolated build's "save aborted work (wip)" / done-move commit SWEPT IT IN onto the `work/<slug>` branch:

- `null-harness-prompt-write-epipe-tolerant` — the kept branch carried `.agent-runner-job.json` (+10 lines); on requeue→re-`do` the continue rebase onto advanced main CONFLICTED and aborted mid-`git switch` ("local changes to `.agent-runner-job.json` would be overwritten by checkout"), leaving the item wedged in-progress on the arbiter. The artifact was a direct contributor to the wedge.
- `do-isolated-in-place` — the opened PR's diff included `.agent-runner-job.json` (+10) alongside the real `cli.ts`/`do.ts`/test work. Gate-2 APPROVED without flagging it; only the conductor's Gate-3 caught it, and the branch was rebuilt off main WITHOUT the artifact before merging.

So the leak is (a) repo pollution (a runtime file committed as if it were source) and (b) a recovery hazard (an uncommitted/committed job file blocks the `git switch` the continue-rebase path performs).

## Why it happens

The job descriptor is written into the worktree (its natural home — it tracks THAT job), but nothing excludes it from git there. The runner's own "save aborted work" / done-move commits use a broad add (so the agent's real edits are captured), which also stages the descriptor. The bare hub mirror / job worktree has no repo `.gitignore` entry for it, and the file lives at the worktree root, so it is a tracked-looking untracked file that broad `git add` grabs.

## The fix (small, layered)

1. **Gitignore it** — add `.agent-runner-job.json` to the repo `.gitignore` (done in the `do-isolated-in-place` landing). This stops a broad `git add` in the work tree from staging it. But it only protects repos whose `.gitignore` has the entry, so:
2. **The runner must never stage it** regardless of repo `.gitignore`: write the descriptor OUTSIDE the worktree (e.g. under `workspacesDir`/a sibling control dir, not the checked-out tree), OR have the runner's commit steps explicitly exclude it (path-exclude / `git add` only the agent's diff, never the control file), OR write it to a path already inside the agents' control area. Writing runtime control state INTO the very tree being committed is the root cause; moving it out is the durable fix.
3. **The continue-rebase path should tolerate it** — a stray control file should not be able to abort the `git switch`/rebase the recovery performs (clean/stash/exclude it first). Cross-ref the `continue-conflict-resurface-from-needs-attention` slice.

## Where

The job-descriptor write (the harness/job machinery — `src/do.ts` `createJob`/`jobWorktreeStrategy` + the `HarnessRecord`/job-state write); the runner's "save aborted work"/done-move commit steps (the broad `git add` that sweeps it in); `src/do.ts` `performDoRemote` continue path (the `git switch` that the file blocks). Cross-ref: `requeue-and-recovery-assume-local-checkout-no-remote-arbiter-form.md`, the `continue-conflict-resurface-from-needs-attention` backlog slice. The `.gitignore` entry is a partial mitigation landed with `do-isolated-in-place`; the durable fix (write the control file outside the committed tree) is unbuilt.
