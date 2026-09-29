---
title: 'The CI reap job releases per-item locks whose item is already terminal on main'
slug: ci-releases-locks-of-terminal-items
blockedBy: []
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `locks-of-merged-propose-items-are-never-released-in-ci`: after propose PRs merged, their per-item locks stayed on the arbiter across later `advance-lifecycle` ticks; the design releases such a lock "by the next claim (or `dorfl status --reconcile-locks`)", but a merged item is never claimed again and no generated job reconciles. They block nothing but accumulate.

Have the no-agent `reap-merged-branches` job (it runs `dorfl gc --remote-branches`) also release every per-item lock whose item is terminal on the arbiter's `main` (the same predicate `status --reconcile-locks` uses), scoped to this arbiter, leased on the sha it read, and reported in the job log. Prefer doing it inside the `gc --remote-branches` verb (or a flag it already takes) so the generated workflows need no change; if a workflow change is unavoidable, stop and route to needs-attention (that would make this task humanOnly).

## Acceptance criteria

- [ ] After the reap, a lock whose item is in `tasks/done/` (or another terminal folder) on `main` is gone; a lock whose item is not terminal is untouched (tested against a bare arbiter).
- [ ] A lock that moved between the read and the delete is not released (lease).
- [ ] The generated workflows are unchanged.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: stop terminal-item locks accumulating in CI. Read `gc --remote-branches` (`reap-branches.ts`, `gc.ts`), the terminal-lock reconcile behind `dorfl status --reconcile-locks`, and the `reap-merged-branches` job in the generated `advance-lifecycle.yml`.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Put the release inside the existing `gc --remote-branches` run, with no new flag.** Why: the task prefers the verb, and a flag would require a workflow change, which the task forbids. The orphan-sidecar sweep already rides this same command. Alternative: an opt-in flag such as `--reconcile-locks` on `gc`. That would need the workflow to pass it, making the task humanOnly. What it touches: this changes what `gc --remote-branches` does by default, for humans as well as CI (it now also deletes lock refs). `--dry-run` still previews it.
- **Locks only, not stale question state.** Why: `status --reconcile-locks` and the task are about locks. The other half of the terminal reconcile, `reconcileTerminalState`, publishes a commit to `main` to clear stale question state, which is a different kind of write that nobody asked the reap job to do. Alternative: call `reconcileTerminalState` and do both. It touches no other command.
- **A lock kept on error does not change the exit code.** A rejected lease or a failed classification is printed as `[kept]` and counted in the summary, but the command still exits 0, just as it already does for retained branches. Why: a concurrent-move rejection is a transient race that the next tick settles, and failing the scheduled job for it would be noise. Alternative: exit non-zero, like `gc --ledger --reap-stale-locks` does when something needs attention. It touches the `reap-merged-branches` job status.
- **Terminal-only scope, not the wider orphan class.** The release covers only locks whose item is terminal on `main`. Locks that `gc --ledger --reap-stale-locks` would also clear (surfaced items on non-terminal work) are left to that explicit, human-run sweep, keeping the same scope fence `reconcileTerminalItemLocks` documents. The new name, `sweepTerminalItemLocks`, follows the existing `sweepRemoteMergedBranches` naming; it reuses the existing predicate rather than introducing a new concept.
