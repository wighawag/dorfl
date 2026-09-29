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
