---
name: to-task
disable-model-invocation: true
description: 'Task a spec or plan into independently-grabbable, file-based work tasks using tracer-bullet vertical tasks.'
---

# to-task

**The tasking discipline lives in `work/protocol/TASKING-PROTOCOL.md`** (the in-band protocol doc every set-up repo carries; the source-of-truth is `skills/setup/protocol/TASKING-PROTOCOL.md`). This skill is the **human-facing pointer** to that standard — the operator entry point a person reaches for to invoke the discipline interactively. The standard itself (the discipline, the two-axis gate guidance, the confidence check, and the emitted task shape) is stated ONCE in the protocol doc so the autonomous runner (the `do prd:<slug>` tasking path) and the human caller stay in step.

This skill stays **user-invoked** (`disable-model-invocation: true`): unlike `review` and `surface-questions` (model-invoked disciplines the runner spawns by name), the tasker is reached for explicitly — a human or operator decides to task a spec.

## How to use

1. Read `work/protocol/TASKING-PROTOCOL.md` in the repo you are working in.
2. Apply its discipline to the source `work/specs/ready/<slug>.md` (or design doc / plan): explore the codebase, draft the vertical tasks, quiz the user (or do the confidence check if no human is present), and write the task files under `work/tasks/backlog/`.
3. Trim the spec to its durable framing and move it `work/specs/ready/ → work/specs/tasked/` (the one-time hand-off transition the doc describes).

> Why the standard lives in `work/protocol/`: a discipline the autonomous runner invokes BY NAME (the `do prd:<slug>` tasking path reads it via `resolveProtocolDoc`) must be in-band in every set-up repo, not host-installed. Operator skills (this file) are human-facing and not copied.
