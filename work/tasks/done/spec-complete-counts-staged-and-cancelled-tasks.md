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

## Decisions

- **All tasks cancelled: the issue stays open.** It is neither closed as `completed` nor as `not planned`. Nothing was delivered, so `completed` would be false. Closing as `not planned` is an irreversible, user-visible action that a merge-to-main job would be guessing at; giving up on an issue should be a human's call (drop the spec, close the issue by hand). The alternative I considered was closing it as `not planned` automatically. This touches `close-merged-issues`, the CI close-job workflow, and its log output.
- **New decision value `cancelled`.** It is used both for a spec whose tasks are all cancelled and for a cancelled lone task, so the CLI log says `left open (cancelled)` instead of the misleading `not-complete` or `not-landed`. The CLI prints the decision generically, so nothing else needed changing. The alternative was reusing `not-complete` / `not-landed`. It uses the same word as the existing `tasks/cancelled` folder with the same meaning.
- **I widened the shared `TASK_LIFECYCLE_FOLDERS` constant** instead of adding a second list used only by the completeness check. Its own description says it is "where a spec task or lone-task `issue:` can reside", and staged and cancelled tasks fit that. The alternative was a separate list for `spec-complete.ts`.
- **Who uses these, and what I found:**
  - `isSpecComplete` is only called by `close-job.ts`; that call is fixed and now also reads `allCancelled`. It is also exported from `index.ts`, where the result gains the new field.
  - `TASK_LIFECYCLE_FOLDERS` is used only by `spec-complete.ts` (fixed) and by the lone-task candidate scan in `close-job.ts` (fixed: staged and cancelled lone tasks are now reported instead of skipped).
  - `sidecar.ts` only mentions it in a comment and deliberately uses its own list, which already includes backlog and cancelled. That is still correct and I left it alone. The comment still says the constant omits `cancelled` and `tasks-backlog`, which is now out of date; I did not edit it.
  - `in-progress` stays in the list: it is a retired folder, so it is harmless to scan, and removing it is outside this task.
