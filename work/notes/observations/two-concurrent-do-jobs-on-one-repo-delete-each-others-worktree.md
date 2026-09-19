---
title: 'Two concurrent `dorfl do` jobs on ONE repo delete each other''s worktree and claim, and the reported error names neither'
slug: two-concurrent-do-jobs-on-one-repo-delete-each-others-worktree
date: 2026-09-18
status: spotted
needsAnswers: false
---

2026-09-18, measured on `dorfl` 0.13.4 while driving the ADR-0086 task family in `github.com/wighawag/etherfold` (recorded there first, moved here because the defect is the RUNNER's). The two dependency-free tasks of that family were dispatched as two concurrent `dorfl do task:<slug> --isolated` jobs against the same repo. Both died, and neither death was the agent's fault.

## What happens

The second job's setup removed the FIRST job's worktree under `~/.dorfl/work/` and replaced its per-item claim in `~/.dorfl/claim/` with its own, while the first job was still claimed and still doing correct work.

That agent diagnosed the teardown itself: every subsequent shell call failed with `Working directory does not exist`, so it had no execution surface, could not write a source file, and could not even write an observation note because `work/notes/observations/` lived in the deleted tree. It correctly refused to write into the surviving sibling's worktree, on the grounds that the tree belonged to a different item under a different lock.

It is SYMMETRIC, which is what makes it expensive. When the first job exited, its cleanup took the SURVIVOR's worktree with it: the second job ran on for another twenty-five minutes and then failed with `git add -A failed (exit 128): fatal: not a git repository`, its directory still present but its `.git` link gone. So the pair loses both runs, and the second loss arrives long after the cause.

## Why it costs more than it should

**The cleanup is not job-scoped.** An exiting job's reap reaches a sibling job's tree on the same repo mirror, rather than only its own.

**The reported error names neither the deleted path nor the sibling that deleted it.** The first failure surfaced as:

```
failed to spawn 'git': not found (tried '/run/current-system/sw/bin/git').
Is git installed and on PATH? ...
```

`git` was present and on PATH throughout. The spawn failed because the process's `cwd` had been deleted, which Node reports as `ENOENT`, and that is then rendered as a missing binary. The obvious readings (a broken PATH, a missing git, a NixOS store problem) are all wrong, and ruling them out costs real time. Reporting `ENOENT` on spawn as "cwd is gone" whenever the cwd no longer exists would have made this self-diagnosing.

## Scope

`maxParallel: 2` with `perRepoMax: 2` was the resolved config, so per-repo concurrency is something the tool advertises. It appears to hold for `run`, which owns the whole tick and schedules its jobs itself; it does NOT hold for two independently dispatched `do` invocations against one repo.

The practical consequence for a conductor: `drive-tasks` documents deliberate parallelism over file-orthogonal tasks in `--propose` mode, and that is unusable through `do` until this is fixed. The ADR-0086 family had four migrate batches explicitly built to be file-orthogonal so they COULD run in parallel; all six ended up serialised, and the whole 14-task drive ran one at a time.

Unverified: whether `run`'s own scheduling is genuinely safe here or merely not yet observed to collide, and whether `--remote` jobs against one mirror have the same shape.
