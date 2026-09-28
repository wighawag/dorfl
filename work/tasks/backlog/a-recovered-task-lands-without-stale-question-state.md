---
title: 'A task that lands after a needs-attention recovery does not keep needsAnswers: true or a stranded question sidecar'
slug: a-recovered-task-lands-without-stale-question-state
blockedBy: []
---

## What to build

Every task in the CI-split drive that was surfaced to needs-attention and then recovered (requeue, or a re-dispatch continuing from the kept branch) landed in `work/tasks/done/` still carrying `needsAnswers: true` in its frontmatter (for example `ci-split-handoff-artifact-format`, `ci-split-build-path`, `ci-split-agent-result-and-reruns`, `ci-split-landed-vs-gated-report`). The surface set the flag on `main`, and the done-move carried it along. The matching question sidecar was drained later by a separate "drain stranded question state ... (terminal on main)" commit on the next claim, and `work/questions/task-ci-split-docs-drift-and-rollout.md` is still stranded because no claim ran after it. The flag is inert on a done item, but it is false information in the ledger and it misleads any reader or tool that scans `needsAnswers`.

When a task transitions to `done/` (or another terminal folder), clear `needsAnswers` and drain the item's own stuck/needs-attention sidecar in the same land, on every land path (propose and merge, laptop and the CI apply phase). Also clean up the current state of this repository's ledger once (the done files above and the stranded sidecar) as part of the change.

## Acceptance criteria

- [ ] Landing a task that was surfaced and then recovered leaves no `needsAnswers` in the done file and no sidecar under `work/questions/` (tested on the land primitive, merge and propose).
- [ ] A task that lands normally is unchanged.
- [ ] This repository's `work/tasks/done/` holds no `needsAnswers: true` and `work/questions/` holds no sidecar for a terminal item after this task.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: stop recovered tasks from landing with stale question state. Read the done-move in the land path (`integration-core.ts`, `complete.ts`), the surface that sets `needsAnswers` (`surfaceStuckToNeedsAttention`), and the 'drain stranded question state' reconcile that runs on the next claim. Prefer doing it in the done-move commit itself.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
