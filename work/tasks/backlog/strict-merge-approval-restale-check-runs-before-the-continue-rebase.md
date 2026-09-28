---
title: 'Run the strictMergeApproval re-stale check before the answered merge's continue rebase, so it can actually fire'
slug: strict-merge-approval-restale-check-runs-before-the-continue-rebase
blockedBy: []
needsAnswers: true
---

## What to build

Observation `strict-merge-approval-restale-check-runs-after-the-continue-rebase`: in `apply-merge-action.ts`, both the laptop `performMergeAction` and the CI agent half `prepareMergeLand` call `mergeBaseMoved(job)` AFTER `createJob`, and `createJob` has already rebased the kept `work/task-<slug>` onto the freshly fetched `main`. `mergeBaseMoved` compares `merge-base(HEAD, <origin>/main)` with `<origin>/main`, which are then equal, so with `strictMergeApproval: true` an answered merge still lands after a green re-verify instead of re-surfacing when the base moved since the human answered. Because of this, `ci-split-answered-merge-action`'s three-process `merge-restale` test had to hand its intent over directly.

Decide staleness against what the human approved: take the base the answer was given against (the kept branch's merge-base with `main` before any rebase, or a base recorded with the answer if one exists) and compare it with the current `main` BEFORE the continue rebase runs; then rebase. Keep one implementation for the laptop and the CI agent half.

## Acceptance criteria

- [ ] With `strictMergeApproval: true`, an answered merge whose base moved since the answer re-surfaces the follow-up question (laptop path, tested).
- [ ] The CI agent phase hands over `merge-restale` for the same case from a real agent-phase run, and `ci-phase-answered-merge-e2e.test.ts`'s re-stale case no longer injects its handoff.
- [ ] With `strictMergeApproval` off, or when the base has not moved, the merge lands exactly as today (tested).
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make the strict merge-approval re-stale check meaningful. Read `apply-merge-action.ts` (`performMergeAction`, `prepareMergeLand`, `mergeBaseMoved`), `workspace.ts` `createJob` (its continue rebase and the `localContinue` option), how the merge answer is recorded in the sidecar, and `ci-phase-answered-merge-e2e.test.ts`. The observation named in the task body has the analysis.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
