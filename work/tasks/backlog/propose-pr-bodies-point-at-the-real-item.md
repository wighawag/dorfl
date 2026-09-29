---
title: 'Every propose PR body points at the item it carries: the tasked spec for tasking, the staged document for intake'
slug: propose-pr-bodies-point-at-the-real-item
blockedBy: [intake-reports-the-pr-it-actually-opened]
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `tasking-and-intake-pr-bodies-point-at-the-wrong-file`: tasking PR #10 opened with `Task: work/tasks/done/text-layout-module-wrap-pad-and-align.md`, a path that never exists, because `composeProposeBody` (`integration-core.ts`) always writes a task's done path and the tasking land reuses it for a spec (the real file is `work/specs/tasked/<slug>.md`). Intake PRs have an empty body: no pointer to the staged task or spec, nor to the issue.

Make the header name the item's real resting path for each land kind (task build: `work/tasks/done/<slug>.md`; tasking: `work/specs/tasked/<slug>.md`; intake: the staged `tasks/backlog/` or `specs/proposed/` path plus `Closes/relates to #<issue>`-style context, without auto-closing keywords that would close the issue on merge), and give intake PRs a short body.

## Acceptance criteria

- [ ] The tasking PR body names `work/specs/tasked/<slug>.md` (tested through the tasking land).
- [ ] The intake PR body names the staged document and the source issue, without a closing keyword (tested).
- [ ] Task build PR bodies are unchanged.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- `intake-reports-the-pr-it-actually-opened`

## Prompt

> Goal: fix the reviewer pointer in propose PR bodies. Read `composeProposeBody` and its callers in `integration-core.ts`, `composeTaskingProposeBody` in `tasking.ts`, and the intake emit path in `intake.ts`.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
