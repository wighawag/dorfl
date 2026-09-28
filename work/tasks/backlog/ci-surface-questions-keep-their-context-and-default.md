---
title: 'Carry a surfaced question's context and suggested default through the CI handoff'
slug: ci-surface-questions-keep-their-context-and-default
blockedBy: []
---

## What to build

`ci-split-treeless-rungs` (Decisions) records that in CI the `surface` and `triage` handoffs carry surfaced questions as plain question text only, because the handoff format's `questions` field is a list of bounded strings (`ci-handoff-format.ts`). The `surface-questions` agent's optional per-question context and suggested default are dropped, so a question surfaced by CI is poorer than the same question surfaced on a laptop (the human answers without the default or the context the agent gave). An `apply-decision` `ask` with several questions is also joined into one follow-up question.

Extend the handoff record so a surfaced question can carry its bounded context and suggested default (a closed object shape with size limits, validated like every other field, never free-form keys), bump or version the schema if needed, write them from the agent phase, and have the apply phase's replay produce the same sidecar the laptop does. Keep an `ask`'s questions separate.

## Acceptance criteria

- [ ] A CI `surface` handoff with questions that carry context and a default produces the same sidecar as the laptop run of the same scenario (extend the tree-less three-process comparison).
- [ ] An `apply-decision` `ask` with two questions surfaces two questions.
- [ ] The new fields are bounded and validated; an unknown key, an oversize value or a wrong type is rejected (tests).
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: stop CI from degrading surfaced questions. Read the `surface`, `triage` and `apply-decision` rows in `packages/dorfl/src/ci-handoff-format.ts`, the tree-less phase split in `ci-phase-treeless.ts` (its replays and the Decisions of `ci-split-treeless-rungs`), and how the laptop persists surfaced questions with context and defaults (`persistSurfacedQuestions`, the sidecar format).

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
