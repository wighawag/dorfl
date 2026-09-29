---
title: 'A spec issue closes only when every task of the spec is done: staged tasks count as open, cancelled ones need a rule'
slug: spec-complete-counts-staged-and-cancelled-tasks
blockedBy: []
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `spec-complete-ignores-staged-backlog-tasks` (serious, pre-existing): issue #4 (a spec from intake) was closed with "every task of spec ... has landed in `work/done/`" as soon as its first task merged, while two of its three tasks were still in `work/tasks/backlog/`. `isSpecComplete` (`spec-complete.ts`) scans only `TASK_LIFECYCLE_FOLDERS` (`tasks-ready`, `in-progress`, `done`) and tasking stages new tasks in backlog by default, so staged tasks are invisible.

Count every task that names the spec wherever it lives: a task in `tasks/backlog/`, `tasks/ready/` or in progress keeps the spec incomplete. For `tasks/cancelled/`: a cancelled task does not block completion, but a spec whose tasks are ALL cancelled (none done) is not "completed" and its issue must not be closed as completed (leave it open or close it as not planned, and record the choice). Check the other callers of `isSpecComplete` and `TASK_LIFECYCLE_FOLDERS` for the same blind spot.

## Acceptance criteria

- [ ] A spec with one task done and one staged in backlog is not complete, and the close-job leaves its issue open (tested).
- [ ] A spec with all tasks done closes its issue as today (tested).
- [ ] The all-cancelled case follows the rule you record (tested).
- [ ] Other `isSpecComplete` / `TASK_LIFECYCLE_FOLDERS` callers are checked and fixed or confirmed correct (say which in the Decisions).
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: stop the close-job closing a spec's issue while work is still staged. Read `spec-complete.ts`, `close-job.ts`, `work-layout.ts` (`TASK_LIFECYCLE_FOLDERS`, the folder keys), and grep (bounded) for other users of both.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
