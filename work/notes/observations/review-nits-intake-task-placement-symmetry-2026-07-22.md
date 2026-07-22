---
title: review-gate non-blocking nits for 'intake-task-placement-symmetry' (Gate 2 approve)
date: 2026-07-22
status: open
reviewOf: intake-task-placement-symmetry
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-task-placement-symmetry' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify decision 1: the agent added a new user-visible CLI flag --tasks-land-in on the intake command (twin of --specs-land-in). It reuses the existing explicitTasksLandInFromFlag helper and the tasksLandIn config key, so no new validation or config concept; it is additive/optional and not yet set by intake.yml (deferred to the next task). Looks correct and coherent.
  (cli.ts new .option + explicitTasksLandIn wiring; recorded in work/notes/observations/2026-07-23-intake-task-placement-symmetry-decisions.md #1)
- Ratify decision 2: TASK_PLACEMENT_SLOTS and landingToSide were exported from tasking.ts (were module-private) so intake dispatchTask shares one copy of the task folder names + backlog|ready->staging|pool mapping. No import cycle (tasking does not import intake). This is the reuse the task mandated, not a fork.
  (tasking.ts exports; intake.ts imports them; recorded decision #2)
- Trusted-path folder default changed from tasks/ready to tasks/backlog for ALL intake task emits, not only untrusted ones. This is spec-sanctioned (US 8 names it as the sole behaviour change) and reflected in config default tasksLandIn:backlog, but the task acceptance line says trusted path is unchanged. Confirm the wording drift is acceptable; the mechanism (placed per tasksLandIn) is unchanged even though the effective default folder moved.
  (pre-existing intake tests flipped ready->backlog; spec US 8)
