---
title: 'Merge-questions gate axis — separate from `observationTriage`, higher default'
slug: merge-questions-gate-axis
spec: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: false
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

## Open questions (needsAnswers — spec OQ7)

The SEPARATION + higher-default is fixed. These three sub-decisions are
not:

1. **Gate name.** Candidates: `mergeQuestions`, `surfaceMerge`, or
   another option consistent with the existing gate vocabulary. Pick
   one.
2. **Default value.** `ask` (surface + wait for a human answer) is the
   spec's likely default; `auto` is allowed only for repos that trust
   auto-landing of answered/unblocked merges (a merge-mode-like fast
   path); `off` is only correct for a repo that lands by some other
   means. Pick the default.
3. **Shape.** Three-state `off | ask | auto` mirroring
   `observationTriage`, or boolean? The spec leans 3-state; confirm or
   override. NOTE the `auto` sub-state was originally defined as
   "auto-land an answered/unblocked MERGE DISPOSITION" — the
   disposition vocabulary was retired (keystone
   `agentic-question-resolution-retire-disposition-vocabulary`), so
   restate `auto` in BINARY-answered / runner-action terms: "a
   surfaced merge-question that is answered (or needs no answer) is
   auto-landed via the answer-driven land action" (see
   `apply-rung-merge-disposition`). The gate's FIXED parts (separate
   axis, default not `off`, same precedence chain) do NOT depend on the
   retired vocabulary.

Do NOT build until OQ7 is answered.

Cross-cutting note: the spec's "Part of a larger generalization"
section lists two CROSS-CUTTING questions (sidecar-keying to a lock-
ref/branch identity; questions-folder shape/name) that are SHARED with
the stuck-lock surfacer sibling and must be resolved ONCE across both,
not twice. That resolution is its own concern — it is NOT a blocker
for THIS task, but the implementation here should not preempt either
sub-decision.

## Acceptance criteria

- [ ] New gate resolved via the existing precedence chain (extends the
      same helper used by `merge-retries-gate-precedence` and sibling
      gates).
- [ ] Default value matches the resolved OQ7 answer; default is NOT
      `off`.
- [ ] `merge-question-surfacer` is invoked iff this gate's resolved
      value says so (the wiring is part of this task).
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
> answered: read Story 17 + the spec's "Implementation Decisions"
> paragraph that fixes the SEPARATION + higher-default. Locate the gate
> precedence helper extended by `merge-retries-gate-precedence` (or, if
> that task hasn't landed yet, the sibling gates' helper) and add the
> new axis in the same shape. Wire `merge-question-surfacer` to gate
> its invocation on the new axis. Tests mirror sibling gate-precedence
> tests in style. Run the AGENTS.md acceptance gate.

## Applied answers 2026-06-26

### q1: OQ7(a) — Gate name: what is the exact name for the new merge-question gate axis? Candidates named in the SPEC/task: `mergeQuestions`, `surfaceMerge`, or another camelCase name consistent with the existing gate-family vocabulary.

`mergeQuestions` (matches SPEC sidecar Q3). It names the policy domain the way `observationTriage` does, reads cleanly in the `flag > env > per-repo > global > default` chain, and avoids the verb-flavoured `surfaceMerge`.

### q2: OQ7(b) — Default value: what is the built-in default for the merge-question gate? `ask` (surface + wait for a human answer), `auto` (auto-land an answered/unblocked merge — the merge-mode-like fast path), or `off` (only for a repo that lands by some other means)? The fixed constraint is: it must NOT default to `off`.

`ask` (surface + wait for the human's plain merge|hold|drop answer). It is the conservative default that honours propose semantics and never silently drops pushed work, and it does NOT depend on the retired disposition mechanism. `auto` is restated for the deterministic-action model (Q3 below) and is available as a trusted-repo fast path; `off` only for a repo that lands by some other means. Matches SPEC sidecar Q3.

### q3: OQ7(c) — Shape: is the gate a three-state `off | ask | auto` mirroring `observationTriage`'s shape, or a boolean? The SPEC leans 3-state; confirm or override.

Three-state `off | ask | auto`, mirroring `observationTriage`, with `auto` restated WITHOUT the retired token: `auto` = the runner self-supplies the `merge` answer without surfacing and lands through the SAME deterministic runner-action dispatch + apply-time re-verify (SPEC sidecar Q1/Q3). It does NOT invoke the agentic decider — a merge-land is never an agent decision. The 3-state shape is preserved because the surface-vs-auto-land distinction is real and useful; the middle (`ask`) is the default.

### q4: Should this task be HELD (kept out of the build pool) and/or re-scoped until the sibling `merge-question-surfacer` is re-decomposed against the retired-disposition model — and does answering OQ7 require restating `auto` without the `merge|hold|drop` token mechanism?

This task is the LEAST drifted of the three (it only gates invocation), and its FIXED parts (separate axis, default not `off`, same precedence chain) plus its name/default/shape (Q1-Q3) do NOT depend on the retired vocabulary — so DECIDE them here (done above) rather than hold the whole task. The only entanglement was `auto`'s meaning, now restated against the deterministic-action model. KEEP this task in `tasks/backlog/` (not promoted to the pool) and build it together with / after `merge-question-surfacer` + `apply-rung-merge-disposition` so the `merge-question-surfacer is invoked iff this gate says so` wiring lands against the reshaped surfacer. The cross-cutting sidecar-keying + questions-folder questions are answered ONCE in SPEC sidecar Q5 (branch/ref key allowed; typed `kind` field now, kind-subfolders later via `task:questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21`); do not preempt the folder restructure here.
