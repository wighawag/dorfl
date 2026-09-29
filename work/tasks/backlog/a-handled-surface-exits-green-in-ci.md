---
title: 'A CI phase that cleanly surfaced an item (protected path, rejected handoff, agent STOP) ends its job green'
slug: a-handled-surface-exits-green-in-ci
blockedBy: [ci-phase-logs-each-line-once]
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `a-handled-rejection-marks-the-item-run-red`: the apply job for a task that added a root `.gitattributes` rejected the handoff (`protected-path`), surfaced the task and wrote nothing, exactly as designed, but exited 1, so the run shows as failed next to runs that genuinely broke. Separately, a lock phase that finds the item already locked and backs off also ends red.

Apply the repository's existing rule "a clean surface is green" to the CI phases: a handled outcome (the item was surfaced to needs-attention, a handoff rejected and surfaced, a lock lost to another run, a stale-lock refusal on a re-run) exits 0 with a clear log line; only an unhandled failure (the surface itself failed, an unexpected error, a refused publish that left state inconsistent) exits non-zero. Record the exact mapping in the Decisions.

## Acceptance criteria

- [ ] A protected-path rejection that surfaced the item exits 0 (tested at the phase entry point).
- [ ] A lock phase that backs off because another run holds the lock exits 0.
- [ ] A surface that could not be written still exits non-zero (tested).
- [ ] The generated workflows need no change (the apply job's exit code is the only signal).
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- `ci-phase-logs-each-line-once`

## Prompt

> Goal: make CI run colours mean something. Read the exit codes returned by `performBuildPhase`, `performTaskingPhase`, the tree-less and intake phases (`ci-phase-*.ts`) and how `cli.ts` exits with them; the existing "a clean surface is green" rule is referenced in the `ci-split-build-path-non-integrate-intents` Decisions.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
