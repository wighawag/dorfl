---
title: 'A failed continue rebase reports git's error and what it rebased onto, and only a real conflict is called a conflict'
slug: a-failed-rebase-reports-its-real-cause
blockedBy: []
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `ci-answered-merge-reports-a-conflict-a-plain-rebase-does-not-have`: in the CI answered-merge agent phase for `task:add-a-title-case-helper` (run 36532804273), dorfl reported `rebasing ... onto current main conflicted (aborted, never auto-resolved)` and surfaced the item, but a plain `git -c merge.directoryRenames=false rebase origin/main` of the same branch succeeds cleanly (the branch only adds new files and renames its own task body). `rebaseContinuedBranchOntoMain` (`continue-branch.ts`) maps ANY non-zero rebase exit to `{kind: 'conflict'}` and discards git's stderr, and the `createJob` path rebases onto the job mirror's local `main`, whose sha is never logged, so the real cause is invisible.

Distinguish a real conflict (git reports conflicting paths) from any other rebase failure, carry git's stderr and the `main` sha rebased onto into the note and the needs-attention reason, and then reproduce the sandbox case (a private repository, the CI agent phase with the read token passed per command, the answered-merge `createJob` path) to find and fix the real cause. If the cause turns out to need a workflow change, stop and route to needs-attention with the finding.

## Acceptance criteria

- [ ] A rebase that fails for a non-conflict reason reports that reason and git's stderr, not 'conflicted' (tested).
- [ ] A real conflict still routes as today, now naming the conflicting paths and the `main` sha (tested).
- [ ] The CI answered-merge case is reproduced in the three-process harness and fixed, or the root cause is recorded precisely if it lies outside dorfl.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make rebase failures diagnosable and fix the false conflict. Read `rebaseContinuedBranchOntoMain` in `continue-branch.ts`, `createJob` in `workspace.ts` (the mirror fetch and `localContinue`), `prepareMergeLand` in `apply-merge-action.ts`, `ci-read-token.ts`, and `test/ci-phase-answered-merge-e2e.test.ts`.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
