---
title: 'An agent run whose last turn was cut off (stopReason length or error) routes as agent-failed, never as an empty-diff dispose question'
slug: a-truncated-agent-turn-routes-as-agent-failed
blockedBy: []
---

## What to build

Observation `a-truncated-model-turn-is-read-as-nothing-to-do-and-defaults-to-cancel`: while building `ci-split-answered-merge-action`, the build agent's last assistant turn ended with `stopReason: "length"` (the whole 16,384-token output budget went into thinking, no text, no tool call). pi's print run ended, the worktree had no change, and the runner's deterministic empty-diff backstop routed it as an empty-diff STOP, surfacing a question whose default is to CANCEL the task (`work/tasks/cancelled/`). A real, unbuilt task was one default answer away from being disposed.

The empty-diff route is for an agent that judged there was nothing to build. A turn cut off by the token cap (or ended by a provider error) is a harness failure. Read the pi session's final assistant turn after the launch (`watch-session.ts` already parses `stopReason` from the session log; reuse that reader rather than a second parser) and, when it stopped for `length` or `error` rather than a normal end of turn, route the run as `agent-failed` (the existing failure route with its WIP save and requeue-ability) with a reason that names the stop cause. Only a normal end of turn may reach the empty-diff backstop. Apply the same rule on every path that has the empty-diff backstop (in-place `do`, the isolated/remote pipeline, `run`, and the CI build agent phase, where it becomes an `agent-failed` handoff).

## Acceptance criteria

- [ ] A build whose session ends on a `length` stop with an empty diff is routed `agent-failed` (lock released per the failure route, no dispose question), with a reason naming the truncated turn; a test drives it with a fake session log.
- [ ] The same with `stopReason: error`.
- [ ] A session that ends normally with an empty diff still takes today's empty-diff route (unchanged, tested).
- [ ] The CI build agent phase hands over `agent-failed` for a truncated turn (three-process or in-process test).
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: stop dorfl misreading a truncated model turn as a deliberate 'nothing to build'. Start from the empty-diff backstop in `packages/dorfl/src/do.ts` (`emptyDiffStopReason`, the stop resolution around `resolveStopReason`), the pi harness record (session file pointer), and `watch-session.ts`'s session reader (`stopReason`). Also look at `run.ts`'s stop handling, which shares the route. The observation named in the task body has the exact session evidence.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
