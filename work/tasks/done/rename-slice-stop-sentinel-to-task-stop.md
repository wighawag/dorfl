---
title: Rename the SLICE-STOP agent-output sentinel to TASK-STOP
slug: rename-slice-stop-sentinel-to-task-stop
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: []
covers: []
---

## What to build

Rename the agent-output wire sentinel the runner detects to stop on a drifted/ambiguous task: `=== SLICE-STOP ===` → `=== TASK-STOP ===` and `=== END SLICE-STOP ===` → `=== END TASK-STOP ===` (Decision 4, clean break — it is an internal token, no compat window).

Update the `STOP_SENTINEL_OPEN` / `STOP_SENTINEL_CLOSE` constants, the prompt text that instructs the agent to emit the block, the no-reason fallback message that mentions "SLICE-STOP", and every test asserting the sentinel (in the SAME task).

## Acceptance criteria

- [ ] The live sentinel constants are `=== TASK-STOP ===` / `=== END TASK-STOP ===`; no live code emits or matches the SLICE-STOP spelling.
- [ ] The agent prompt instructs emitting the new block; the no-reason fallback message uses task vocabulary.
- [ ] Every asserting test (`agent-stop`, `prompt`, `do`/`run`/`do-remote` stop-block fixtures) is updated in this task; suite green.

## Blocked by

- None — can start immediately. (Orthogonal files: the agent-stop module, the prompt builder, and their tests.)

## Prompt

> Goal: rename the internal agent-output STOP sentinel from SLICE-STOP to TASK-STOP, per brief `code-identifier-slice-prd-to-task-brief-rename` Decision 4. It is a wire token matched verbatim by the runner, so the constant, the emitting prompt, and every asserting test must change together.
>
> FIRST check reality (launch snapshot): confirm the sentinel is still the detection mechanism and still matched verbatim. If the stop-detection moved, route to needs-attention.
>
> Where to look: the agent-stop module (the `STOP_SENTINEL_*` constants + parser), the prompt builder that tells the agent to emit the block, and the test fixtures that embed the block (search for the literal `SLICE-STOP`).
>
> Done = build/test/format:check green, no `SLICE-STOP` in live code, the new sentinel detected end-to-end.

---

### Claiming this task

```sh
agent-runner claim rename-slice-stop-sentinel-to-task-stop --arbiter <remote>
git fetch <remote> && git switch -c work/rename-slice-stop-sentinel-to-task-stop <remote>/main
git mv work/tasks/todo/rename-slice-stop-sentinel-to-task-stop.md work/tasks/done/rename-slice-stop-sentinel-to-task-stop.md
```
