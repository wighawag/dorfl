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

## Decisions

- **The schema number stays at 1; the change is additive.** The reader accepts a question as either bare text (what every older writer produced) or the closed object. The writer uses bare text when a question has neither context nor default, and the object only when it has one. Why: the jobs build dorfl from their own checkout, so an agent job and an apply job can run different dorfl versions. This keeps old records readable and keeps the common case readable by an older apply job. Alternative: switch to objects only and bump to schema 2, which would touch every phase writer (`ci-phase-build`, `-tasking`, `-intake`, `-treeless`) and many fixtures. Touches: the handoff format only.
- **The `ask` questions stay plain texts, not objects.** The laptop's decision verdict has no per-question context or default, so there is nothing to carry. Touches: the `apply-decision` row.
- **New optional `DecisionVerdict.questions` field.** It is the only way for the replay to keep an `ask`'s questions separate without duplicating the rung's code. It overlaps `question` (singular); when `questions` is non-empty it wins. The agent's output format and its parser (`parseDecisionVerdict`) are unchanged, so today only the CI replay (or a test decider) sets it. Alternative: change the agent's output format, which is out of scope. Touches: the laptop `ask` path in `advance.ts` (its behaviour is unchanged when only `question` is set).
- **Limits:** the context and the default are each bounded by `reasonChars` (10,000), the same limit as the question. The whole list is still bounded only by the 2 MB `handoff.json` limit, as before.
