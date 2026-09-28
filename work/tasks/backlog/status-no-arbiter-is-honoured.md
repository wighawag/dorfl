---
title: 'dorfl status --no-arbiter is honoured (commander negation), and scan --reconcile-locks is arbiter-scoped like status'
slug: status-no-arbiter-is-honoured
blockedBy: []
---

## What to build

Observation `status-no-arbiter-flag-is-never-honoured`: `status` declares both `--arbiter <remote>` and `--no-arbiter`. Commander treats `--no-arbiter` as the negation of `--arbiter`, so it sets `flags.arbiter = false` and never `flags.noArbiter`. The skip check never fires, and `lockArbiterRemote: flags.arbiter ?? 'origin'` passes `false` as a remote name. Fix it so `--no-arbiter` skips the arbiter section and `--arbiter <remote>` still works (check other commands that pair `--x <v>` with `--no-x` the same way and fix those too).

The same observation notes that `scan --reconcile-locks` still reconciles every registered mirror with no arbiter scope. Give it the same scoping #435 gave `status --reconcile-locks` (current arbiter by default, `--all-arbiters` for the global drain, same refusal when no arbiter resolves), reusing #435's helper.

## Acceptance criteria

- [ ] `status --no-arbiter` skips the arbiter section; `status --arbiter <remote>` uses that remote; with neither, the default is unchanged (tested through the CLI).
- [ ] No other command has the same `--x <v>` / `--no-x` bug (checked; any found are fixed and tested).
- [ ] `scan --reconcile-locks` only reconciles the current arbiter unless `--all-arbiters` is passed (tested with two arbiters), and its help says so.
- [ ] The observation is marked resolved.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: `status`'s arbiter flags do what they say, and no `--reconcile-locks` write reaches another repository implicitly. Read the observation named above, the `status` and `scan` command definitions in `cli.ts`, `status.ts` (`mirrorInReconcileScope`, `reconcileArbiterKey`, from the done task `reconcile-locks-stays-within-the-current-arbiter`) and the scan reconcile path.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED). If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). The task body lives in `work/tasks/backlog/` (a deliberate drive-from-staging build).
>
> RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles. Never read or write the real `~/.dorfl`, `~/.pi` or other real home state from tests: isolate it to a scratch dir.
