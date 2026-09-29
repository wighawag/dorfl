---
title: 'Each dorfl progress line appears once in the CI phase job logs'
slug: ci-phase-logs-each-line-once
blockedBy: []
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `dorfl-log-lines-print-twice-in-ci-phase-jobs`: in the lock, agent and apply job logs most `>>` lines appear twice in a row (for example `>> handed over intake-task for issue:1`). Probably the phase driver both notes a message and the CLI prints the same result message. Print each line once, without dropping any line that is only printed by one of the two.

## Acceptance criteria

- [ ] A phase run (build, intake, tasking, tree-less) prints its result line once (tested by capturing the CLI output of a phase run).
- [ ] No message that was printed once before disappears.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: remove the duplicated log lines. Read `runBuildPhaseAndExit` / the tasking, tree-less and intake phase entry points in `packages/dorfl/src/cli.ts`, and the `note` calls at the end of each `perform*Phase` in the `ci-phase-*.ts` modules.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Fix in the phase drivers, not by filtering in the CLI.** I removed the `note(message)` just before each return instead of having `cli.ts` skip a result line it had already printed. Why: a CLI filter can't un-print the earlier `>> X`, so a failing run would still show `>> X` followed by `error: X`; removing the note gives one line with the right prefix. Alternative considered: a CLI-side filter covering every verb. Touches: the four `ci-phase-*.ts` modules and the documented meaning of each result type's `message` field.
- **`acquireNotingOnce` holds the lock-acquire notes briefly.** `acquireTaskingLock` and `acquireAdvancingLock` are shared with the laptop paths, so I wrapped them in the phase code instead of changing them. Holding their notes until the acquire returns is safe because an acquire is one short push to the arbiter, so the log is not noticeably delayed. Alternative considered: removing the note inside the shared acquire functions, which would also change laptop `advance` and `do spec:` output. Touches: `ci-phase-tasking.ts` and `ci-phase-treeless.ts` lock phases.
- **Changed the shared `decideIntake` failure helper in `intake.ts`.** It no longer notes the message it returns. Both callers (laptop `performIntake` and the CI intake agent phase) return that result, and the CLI prints it, so the only visible change is that laptop `dorfl intake` also stops printing that line twice on those failures. Alternative considered: wrapping the note in the CI phase only, which would have left the laptop duplicate in place. Touches: laptop `dorfl intake` output on decision-agent failures.
