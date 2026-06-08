---
title: Verify/tighten the slicer improver-loop prompt to name the review skill's whole-SET lens explicitly (graph coherence / gaps / overlap / goal-composition)
slug: slicer-loop-set-lens-prompt
prd: slicing-coherence
needsAnswers: true
blockedBy: [slicer-loop-flag-family]
covers: [3]
---

## What to build

US #3 wants the slicer improver loop to review the WHOLE SET of produced slices
(dependency graph coherence, gaps, overlap, "does the set compose into the PRD
goal") rather than just per-slice well-formedness.

**DRIFT — read before building:** the improver loop's prompt
(`buildSliceReviewPrompt` in `src/slicer-review-loop.ts`, landed via the
`slicer-review-edit-loop` slice in `done/`) ALREADY frames the artifact as "the
CANDIDATE SLICES just produced" (the whole set), tells the agent to "review the
candidate DECOMPOSITION adversarially", "apply the review skill's lenses IN
ORDER", and ENDS in the DESTINATION CHECK ("if every slice is built exactly as
written, do we end up with the system the PRD describes?"). It also carries the
set-level routing channels (`uncertainSlices`, `decompositionUnclear`). So the
core of US #3 appears ALREADY SATISFIED. See
`work/observations/slicer-prompt-already-uses-set-lens.md`.

This slice is therefore scoped as a VERIFY + minimal TIGHTEN: confirm the prompt
(and the `review` skill's set-of-slices mode it invokes) explicitly names graph
coherence / gaps / overlap, not only the implied destination check, and add the
missing words if any are genuinely absent. It is doc/prompt-shaped where it
touches the skill — NOT a from-scratch rewrite of a correct prompt.

## Open questions (clear `needsAnswers` before building)

1. **Is ANY prompt change actually wanted?** The destination check already implies
   graph/gaps/overlap. Does the maintainer want those three lenses NAMED
   explicitly in `buildSliceReviewPrompt` (and/or the `review` skill's
   set-of-slices section), or is the current implication sufficient and this slice
   should be CLOSED as already-done (move to `out-of-scope/` / delete)?
2. **If a change IS wanted, where?** In the agent-runner prompt builder
   (`src/slicer-review-loop.ts`), in the `review` SKILL's set-of-slices mode
   (`skills/review/SKILL.md` — an external skills tree), or both? The PRD says
   "doc-shaped where it touches the skill", implying the skill — confirm whether
   the skill is in-repo-editable from this work and in scope.
3. **What is the acceptance signal** for "the loop invokes the set lens"? A
   prompt-content assertion (the prompt string names graph/gaps/overlap)? A
   behavioural test is hard for a prompt — confirm a content/doc assertion is the
   intended bar.

(These are flagged rather than guessed because the premise has drifted: building a
prompt rewrite against an already-correct prompt risks churning a working seam.
One human glance resolves whether this is a no-op closure or a one-line tighten.)

## Acceptance criteria

- [ ] (After the questions are answered) The improver-loop prompt / the `review`
      skill's set-of-slices mode explicitly covers graph coherence, gaps, overlap,
      and goal-composition — OR this slice is recorded as already-satisfied and
      closed with a pointer to the existing prompt.
- [ ] If a change is made: an assertion (prompt-content or doc-shaped) that the set
      lens is named; existing `slicer-review-loop.test.ts` still passes.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `slicer-loop-flag-family` — both touch `src/slicer-review-loop.ts`; serialise to
  avoid a merge conflict (no strict logical dependency, but file-overlap ordering).

## Prompt

> Verify and, if genuinely needed, tighten the slicer improver-loop prompt so it
> explicitly invokes the `review` skill's whole-SET lens (graph coherence / gaps /
> overlap / "does the set compose into the PRD goal"), per US #3 of
> `work/prd/slicing-coherence.md`.
>
> CRITICAL FIRST STEP — this slice carries `needsAnswers: true` because its premise
> has DRIFTED. Read `work/observations/slicer-prompt-already-uses-set-lens.md` and
> `buildSliceReviewPrompt` in `src/slicer-review-loop.ts`: the prompt ALREADY
> reviews the candidate DECOMPOSITION with the review skill's lenses + the
> destination check. Do NOT build until the Open Questions in this slice's body are
> answered by a human (is any change wanted; where; what's the acceptance signal).
> If they are unanswered, leave the slice as-is.
>
> If the answer is "no change needed", record this slice as already-satisfied
> (point at the existing prompt) and let the runner close it. If a tighten IS
> wanted, make the MINIMAL change (name graph/gaps/overlap in the prompt and/or the
> `review` skill's set-of-slices mode) with a content/doc assertion — never a
> rewrite of the working prompt.
>
> "Done" = the questions are resolved and either a minimal, asserted tighten landed
> or the slice is closed as already-satisfied; `pnpm -r build && pnpm -r test &&
> pnpm -r format:check` green.
