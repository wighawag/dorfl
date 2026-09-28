---
title: 'When a run was killed mid-agent, requeue saves its local-only work to the work branch before releasing the lock'
slug: a-crashed-runs-local-work-is-saved-before-its-lock-is-released
blockedBy: []
---

## What to build

During the CI-split drive, a host restart killed `dorfl do task:ci-split-tasking --isolated` mid-agent. The runner's own handler had just made a WIP commit (`chore(ci-split-tasking): save aborted work (wip)`, about 3,200 lines) in the retained job worktree, but the process died before pushing it, so the work existed ONLY locally, the per-item lock stayed `active`, and `dorfl status` listed the job as crashed (no longer alive). `dorfl requeue <slug>` would have released the lock without saving that commit, and `dorfl gc --force --yes` would then have discarded it. The conductor pushed the WIP commit to `work/task-ci-split-tasking` by hand before requeueing.

When requeue (or `gc`) acts on a crashed run whose retained worktree has commits the arbiter's work branch lacks, save them first: commit any uncommitted residue as the usual WIP commit, push the work branch (the same save half `routeToNeedsAttention` uses), then release. If the push fails, keep the lock and the worktree and say so. `gc` without `--force` must keep such a worktree (it has unsaved work); with `--force` it should still refuse to discard pushed-nowhere commits unless the human confirms.

## Acceptance criteria

- [ ] `requeue <slug>` on a crashed run with local-only commits pushes them to `work/task-<slug>` before releasing, and the next claim continues from them (tested with a killed-run fixture).
- [ ] `gc` keeps a retained worktree with commits the arbiter lacks, and reports why.
- [ ] A crashed run with nothing unsaved behaves as today.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: never lose a killed run's local work during recovery. Read `dorfl status`'s crashed-job detection, the requeue path for an `active` lock, `gc`'s deletion-safety predicate (`gc.ts` / `reapJob`), and `routeToNeedsAttention`'s save half. Reproduce with a fixture job worktree that has an unpushed commit.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
