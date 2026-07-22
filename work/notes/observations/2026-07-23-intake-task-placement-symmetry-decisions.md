# intake-task-placement-symmetry — in-scope decisions (2026-07-23)

Decisions made while implementing task `intake-task-placement-symmetry` (route the intake TASK emit through `resolvePlacement` + the origin-trust stamp, parity with the intake SPEC emit). Recorded per the ADR/decision gate so a reviewer/human can ratify. Governing ADR: `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.

## 1. Added a `--tasks-land-in <backlog|ready>` flag to the `intake` command

- **What/why:** The task asked to thread "the explicit `--tasks-land-in` override" into `dispatchTask`. The `intake` command previously had only `--specs-land-in`; the TASK emit hardcoded `tasks-ready` and had no explicit placement override. I added `--tasks-land-in` as the exact task twin of `--specs-land-in` (same TOP-of-precedence role, resolved flag > env `DORFL_TASKS_LAND_IN` > per-repo > global > built-in). It reuses the already-existing `explicitTasksLandInFromFlag` helper (the `do` path's helper) — no new validation logic, no new config key.
- **Alternative considered:** Not adding the flag and only threading `tasksLandIn`/`untrustedTasksLandIn` config. Rejected: the task explicitly lists the explicit override, and omitting it would make the task emit asymmetric with the spec emit (which HAS `--specs-land-in`) — the opposite of the task's parity goal.
- **What it touches:** the `intake` CLI surface (`IntakeFlags.tasksLandIn`, one new `.option(...)`), and `PerformIntakeOptions` (`tasksLandIn`/`untrustedTasksLandIn`/`explicitTasksLandIn`). It does NOT touch the `do`/tasker `--tasks-land-in` (same spelling, same config key `tasksLandIn`, consistent meaning: "where a task lands"). The CI `intake.yml` shell does not set it yet; that (author-trust → placement wiring) is the NEXT task `derive-intake-flags-trust-drives-placement-not-mode`, so the flag is additive/optional here.

## 2. Exported `TASK_PLACEMENT_SLOTS` + `landingToSide` from `tasking.ts`

- **What/why:** The task said "reuse, do not duplicate" the task slots + side mapping that already exist in `tasking.ts`. They were module-private. I exported them and imported them into `intake.ts` `dispatchTask` so the intake TASK emit and the tasker share ONE copy of the task folder names + the `backlog|ready → staging|pool` mapping.
- **Alternative considered:** Re-declaring the slots/mapping inside `intake.ts` (as the spec side already does with its own `SPEC_PLACEMENT_SLOTS`/`specLandingToSide`). Rejected here because the task explicitly says reuse the task ones; a second copy of the TASK slots would be the duplication the task warns against. (No import cycle: `tasking.ts` does not import `intake.ts`.)

## Net behaviour change (default config)

The only user-visible change for a repo that configures nothing new: the intake TASK path now stages the emitted task DOCUMENT in `work/tasks/backlog/` via the resolver (matching what the spec path already does with `specs/proposed/`), instead of hardcoding `work/tasks/ready/`. Whether that document is a PR vs a merge is the operator/config file-emit MODE (`integration: modes.task`), unchanged here. Untrusted safety remains the carried `originTrust: untrusted` stamp, which forces the BUILD transition to a code PR (verified by the new follow-on-build integration test in `intake.test.ts`).
