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

## Decisions

- **Where the save runs:** inside `returnToBacklog`, only when the new `workspacesDir` option is set, which only the `requeue` CLI does. The deadline checkpoint also calls this function but has already saved its own branch, so it is unaffected. The alternative was doing the save in the CLI before the transition, but then it would run even when no lock is held. This touches the `requeue` verb only.
- **No save on `--reset`:** reset means "throw the work away", so pushing it first would contradict the flag. This touches `requeue --reset`.
- **Plain push, not force-with-lease:** a retained worktree can be stale while a newer attempt has already pushed. Refusing a non-fast-forward and keeping the lock is the safe direction. The cost is that a run killed between its continue-rebase and its leased push needs a manual push.
- **New refusal, "lock is KEPT":** `requeue` returns `moved: false` and exits 1 when unsaved work can't be pushed. The task asks for this; it is a new failure mode of `requeue`.
- **Live runs:** if the job record is `running` and its harness says it is alive, the save is skipped and requeue releases the lock as it did before. The alternative was refusing the requeue outright; I didn't, to avoid another new refusal.
- **`gc --force`:** I did not add a second confirmation. The existing `--yes` requirement is already the human confirmation the task asks for. I only added the save hint to the gc report. This touches `gc`'s output format (an extra parenthetical on retained task lines).
- **Push retries:** the save push uses the existing retry-with-backoff defaults (up to about 30 seconds on an unreachable arbiter), so a failing `requeue` can take that long to report. Tests inject a no-wait `sleep`.
