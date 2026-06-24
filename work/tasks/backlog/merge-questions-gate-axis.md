---
title: Merge-questions gate axis — separate from `observationTriage`, higher default
slug: merge-questions-gate-axis
prd: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: true
blockedBy: [merge-retries-gate-precedence]
covers: [17]
---

## What to build

Add a NEW per-repo gate axis that controls whether the merge-question
surfacer is invoked, SEPARATE from `observationTriage`. Resolved through
the SAME precedence chain as the other gates (flag > env > per-repo >
global > default). Fixed at launch in the prd: must NOT ride
`observationTriage`; must default HIGHER than `off`, because a dropped
merge-question means pushed work never lands.

## Open questions (needsAnswers — prd OQ7)

The SEPARATION + higher-default is fixed. These three sub-decisions are
not:

1. **Gate name.** Candidates: `mergeQuestions`, `surfaceMerge`, or
   another option consistent with the existing gate vocabulary. Pick
   one.
2. **Default value.** `ask` (surface + wait for a human answer) is the
   prd's likely default; `auto` is allowed only for repos that trust
   auto-landing of answered/unblocked merges (a merge-mode-like fast
   path); `off` is only correct for a repo that lands by some other
   means. Pick the default.
3. **Shape.** Three-state `off | ask | auto` mirroring
   `observationTriage`, or boolean? The prd leans 3-state; confirm or
   override.

Do NOT build until OQ7 is answered.

Cross-cutting note: the prd's "Part of a larger generalization"
section lists two CROSS-CUTTING questions (sidecar-keying to a lock-
ref/branch identity; questions-folder shape/name) that are SHARED with
the stuck-lock surfacer sibling and must be resolved ONCE across both,
not twice. That resolution is its own concern — it is NOT a blocker
for THIS slice, but the implementation here should not preempt either
sub-decision.

## Acceptance criteria

- [ ] New gate resolved via the existing precedence chain (extends the
      same helper used by `merge-retries-gate-precedence` and sibling
      gates).
- [ ] Default value matches the resolved OQ7 answer; default is NOT
      `off`.
- [ ] `merge-question-surfacer` is invoked iff this gate's resolved
      value says so (the wiring is part of this slice).
- [ ] Does NOT alter `observationTriage`'s default or shape.
- [ ] Tests cover every precedence rung and the default, in the style
      of the existing gate-precedence tests.
- [ ] Acceptance gate green.

## Blocked by

- `merge-retries-gate-precedence` — both extend the same precedence-
  chain helper / config-resolution module; serialise by file to avoid
  conflicts.

## Prompt

> Do NOT build until OQ7 is answered (name, default, shape). Once
> answered: read Story 17 + the prd's "Implementation Decisions"
> paragraph that fixes the SEPARATION + higher-default. Locate the gate
> precedence helper extended by `merge-retries-gate-precedence` (or, if
> that slice hasn't landed yet, the sibling gates' helper) and add the
> new axis in the same shape. Wire `merge-question-surfacer` to gate
> its invocation on the new axis. Tests mirror sibling gate-precedence
> tests in style. Run the AGENTS.md acceptance gate.
