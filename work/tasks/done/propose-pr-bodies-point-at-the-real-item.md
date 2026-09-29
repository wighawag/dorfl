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

## Decisions

- **The intake header names the document's actual placed path, not always `tasks/backlog/` or `specs/proposed/`.** Why: placement can put an intake document straight into the pool (`tasks/ready/` or `specs/ready/`), and the point of the fix is to name the real file. Alternative considered: hard-coding the staged folders the task text lists. That would repeat the original bug whenever intake places a document in the pool. Touches: intake only.
- **`proposeHeader` is required on every non-task land kind, not optional.** Why: an optional field would silently fall back to the task done path, which is exactly how the tasking bug happened. Only two callers exist (tasking and intake), so making it required is cheap and future land kinds must think about it. Alternative considered: optional with the task default. Touches: `integration-core.ts`, `tasking.ts`, `intake.ts`.
- **The intake body wording is new user-visible text.** It is plain prose with a bare `#<n>` reference and deliberately no `closes`/`fixes`/`resolves`. It says the issue stays open because the close job owns closing it. Alternative considered: `Refs #<n>`. I chose a readable sentence that also tells the reviewer merging won't close the issue. Touches: only the intake PR description; the issue completion comment is unchanged.
