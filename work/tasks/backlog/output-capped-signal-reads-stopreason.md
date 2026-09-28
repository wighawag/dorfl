---
title: 'The outputCapped signal reads pi'"'"'s camelCase stopReason, so it only fires on a real cap truncation'
slug: output-capped-signal-reads-stopreason
blockedBy: []
---

## What to build

Observation `output-capped-signal-reads-the-wrong-stop-reason-key`: in `watch-session.ts`, the last-assistant-turn reader takes `message.stop_reason` for the cap signal, and `isOutputCappedTurn` treats an undefined stop reason with `usage.output > 0` as a cap truncation. Real pi session logs carry the camelCase `message.stopReason` (`stop` / `toolUse` / `length` / `error` / `aborted`) and never `stop_reason`, so `LaunchResult.outputCapped` is set on essentially every pi run, and `tasker-review-loop.ts` names any verdict parse failure a cap truncation (`ReviewOutputCappedError`). The newer `finalStopReason` / `cutOffTurnOf` path (task `a-truncated-agent-turn-routes-as-agent-failed`) already reads `stopReason` first.

Read `stopReason` (falling back to `stop_reason` for other harness shapes), treat `length` (and the raw `max_tokens`) as the cap signal, and stop inferring a cap from an undefined stop reason. Reuse the same reader as `finalStopReason` so the two cannot disagree.

## Acceptance criteria

- [ ] A pi-shaped turn with `stopReason: 'stop'` and output tokens is NOT `outputCapped`; one with `stopReason: 'length'` IS (tested with pi-shaped fixtures, ideally modelled on a real session log line).
- [ ] A verdict parse failure on a normally-ended review turn raises the plain parse error, not `ReviewOutputCappedError` (tested).
- [ ] The cap signal and `finalStopReason` read the stop reason through one helper.
- [ ] The observation is marked resolved.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: `outputCapped` means "the turn hit the output-token cap", nothing else. Read the observation named above, `watch-session.ts` (`lastAssistantTurn`, `isOutputCappedTurn`, `finalStopReason`), `pi-harness.ts` (where `outputCapped` is set), `review-verdict.ts` and `tasker-review-loop.ts`. You may read a few lines of a real log under `~/.pi/agent/sessions` to confirm the shape (read-only, bounded: `head -c`), but fixtures must be synthetic.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED). If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). The task body lives in `work/tasks/backlog/` (a deliberate drive-from-staging build).
>
> RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles. Never read or write the real `~/.dorfl`, `~/.pi` or other real home state from tests: isolate it to a scratch dir.
