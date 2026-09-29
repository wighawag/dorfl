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

## Decisions

- **Exact exit-code mapping for all four CI phases.**
  - **Exit 0:** `surfaced`; `rejected` when its surface landed; `lost` (and intake `backed-off`); `stale-lock` in both the agent and apply phases; plus the outcomes that were already 0 (`no-op`, `released`, `landed`, `proposed`, `auto-continued`, a clean stop or agent-failed surface).
  - **Non-zero:** `surface-unmoved`, `stale-lease`, `release-refused`, `publish-refused`, `publish-failed`, `land-failed`, `rung-failed`, `agent-failed`, `usage-error`, lock-phase `gate-refused` and `invariant-violation`, `stale`, intake `rejected` and intake `released`, and any unexpected error.
  - **Why:** this is the task's rule and the existing "clean surface is green" rule applied to CI.
  - **Touches:** only the CI phases' exit codes. The laptop `do`, `advance` and `claim` codes are unchanged.
- **Every `lost` lock outcome exits 0, whatever the underlying code.** This includes a tasking `contended` acquire (previously exit 3) and "spec no longer on main" (previously exit 2). Nothing was written in any of these cases and the next run retries, so it is handled. The alternative was keeping 3 for `contended`; I rejected it because the run's colour is the only signal, and a failed run would not retry any sooner.
- **The agent-phase `stale-lock` also exits 0,** not only the apply re-run case. It writes nothing, and the apply job then hits the same ownership check and also exits 0. The alternative was keeping the agent red; I rejected it because that would redden the run for a handled outcome.
- **Build `surface()` now reports `surface-unmoved` when the surface did not land,** instead of `rejected`/`surfaced`. This matches the tasking and tree-less paths, and the test for "a surface that could not be written" asserts it.
- **Kept red on purpose:**
  - `stale-lease`: the lock is still held and a human must requeue, so the state is inconsistent.
  - `stale` in tree-less and tasking: in one tree-less case the merge landed but the answer was not recorded; tasking `stale` comes from the laptop's own result code. Neither is in the task's list.
  - Intake `rejected` and `released`: nothing is surfaced to a human, the label is just removed, so the red run is the only signal.
  - `gate-refused` and `invariant-violation`: these need a human.
  
  Each of these could be revisited separately.
