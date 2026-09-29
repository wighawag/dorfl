---
title: 'The merge-question surfacer finds namespaced work branches on the arbiter'
slug: merge-question-surfacer-finds-namespaced-work-branches
blockedBy: []
needsAnswers: false
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `merge-question-surfacer-has-no-production-caller` (the mechanical part): run by hand on the sandbox, `listUnmergedWorkBranchesViaGit` (`merge-question-surfacer.ts`) listed the branches but skipped every one with `no-item-body`: it derives the item slug as `ref.slice("work/".length)`, so the namespaced build branch `work/task-<slug>` gives slug `task-<slug>`. It also lists only local `refs/heads/work/*`, which fits a mirror but misses remote-tracking branches in a clone.

Resolve branch names with `parseWorkBranchRef` (both namespaced forms and any legacy form still in use), and list the arbiter's work branches (the remote's refs, or the mirror's local heads when running in the mirror). Do not wire the surfacer into the tick here; that is task `wire-merge-questions-into-the-advance-tick`.

## Acceptance criteria

- [ ] The surfacer surfaces a question for a `work/task-<slug>` branch not reachable from `main` whose task body exists (tested in a clone with only remote-tracking branches and in a mirror).
- [ ] A branch already merged, or with no item body, is skipped as today.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: fix the surfacer's branch discovery. Read `merge-question-surfacer.ts` (`listUnmergedWorkBranchesViaGit`, `surfaceMergeQuestions`), `slug-namespace.ts` (`workBranchRef`, `parseWorkBranchRef`) and its tests.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Applied answers 2026-09-29

### q1: 'task:merge-question-surfacer-finds-namespaced-work-branches' was bounced — how should we proceed?

keep (the gate failed only on 5s timeouts in unrelated tests under host load; the surfacer work on the kept branch is complete, re-run the gate)

## Applied answers 2026-09-29

### q1: 'task:merge-question-surfacer-finds-namespaced-work-branches' was bounced — how should we proceed?

reset (the kept branch cannot rebase: its Decisions and the applied keep answer both append to the task body; rebuild from scratch, human-approved)
