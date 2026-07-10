---
title: Verify/tighten the slicer improver-loop prompt to name the review skill's whole-SET lens explicitly (graph coherence / gaps / overlap / goal-composition)
slug: slicer-loop-set-lens-prompt
spec: slicing-coherence
blockedBy: [slicer-loop-flag-family]
covers: [3]
---

## Answer (2026-06-08 — needsAnswers cleared)

Resolved by the maintainer; the three Open Questions are settled — this slice is a minimal TIGHTEN, not a no-op closure:

1. **Is any prompt change wanted?** YES — option (b). The destination check already IMPLIES graph/gaps/overlap (per `work/observations/slicer-prompt-already-uses-set-lens.md`), but they are not NAMED. Name them explicitly so the intent is legible (and so the conceptual- coherence "overlap / duplicate-or-fork" lens is called out — the exact defect class the duplicate-observation episode hit). Do NOT close/out-of-scope.
2. **Where?** Both, minimally: `buildSliceReviewPrompt` (`src/slicer-review-loop.ts`) AND the `review` skill's set-of-slices mode (`skills/review/SKILL.md`) if it is in-repo-editable from this work; if the skills tree is out of reach, do the prompt builder and FLAG the skill edit for the maintainer. Keep it a few words, not a rewrite of the working prompt.
3. **Acceptance signal?** A prompt-CONTENT assertion (the prompt string names graph coherence / gaps / overlap / goal-composition) — a behavioural test for a prompt is not the bar. The existing `slicer-review-loop.test.ts` must still pass.

## What to build

US #3 wants the slicer improver loop to review the WHOLE SET of produced slices (dependency graph coherence, gaps, overlap, "does the set compose into the PRD goal") rather than just per-slice well-formedness.

**DRIFT — read before building:** the improver loop's prompt (`buildSliceReviewPrompt` in `src/slicer-review-loop.ts`, landed via the `slicer-review-edit-loop` slice in `done/`) ALREADY frames the artifact as "the CANDIDATE SLICES just produced" (the whole set), tells the agent to "review the candidate DECOMPOSITION adversarially", "apply the review skill's lenses IN ORDER", and ENDS in the DESTINATION CHECK ("if every slice is built exactly as written, do we end up with the system the PRD describes?"). It also carries the set-level routing channels (`uncertainSlices`, `decompositionUnclear`). So the core of US #3 appears ALREADY SATISFIED. See `work/observations/slicer-prompt-already-uses-set-lens.md`.

This slice is therefore scoped as a VERIFY + minimal TIGHTEN: confirm the prompt (and the `review` skill's set-of-slices mode it invokes) explicitly names graph coherence / gaps / overlap, not only the implied destination check, and add the missing words if any are genuinely absent. It is doc/prompt-shaped where it touches the skill — NOT a from-scratch rewrite of a correct prompt.

## Acceptance criteria

- [ ] `buildSliceReviewPrompt` (`src/slicer-review-loop.ts`) explicitly NAMES the whole-SET lenses: graph coherence, gaps, overlap, and goal-composition (a few words added to the existing destination-check framing — NOT a rewrite).
- [ ] If the `review` skill's set-of-slices mode (`skills/review/SKILL.md`) is in-repo-editable from this work, it likewise names the three lenses; if the skills tree is out of reach, the prompt-builder edit lands and the skill edit is FLAGGED for the maintainer.
- [ ] A prompt-CONTENT assertion verifies the prompt string names graph coherence / gaps / overlap / goal-composition; existing `slicer-review-loop.test.ts` still passes.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `slicer-loop-flag-family` — both touch `src/slicer-review-loop.ts`; serialise to avoid a merge conflict (no strict logical dependency, but file-overlap ordering).

## Prompt

> Verify and, if genuinely needed, tighten the slicer improver-loop prompt so it explicitly invokes the `review` skill's whole-SET lens (graph coherence / gaps / overlap / "does the set compose into the PRD goal"), per US #3 of `work/prd/slicing-coherence.md`.
>
> CONTEXT — the premise had DRIFTED and is now resolved (see the `## Answer` block: needsAnswers is CLEARED, the decision is option (b), a minimal tighten). Read `work/observations/slicer-prompt-already-uses-set-lens.md` and `buildSliceReviewPrompt` in `src/slicer-review-loop.ts` first: the prompt ALREADY reviews the candidate DECOMPOSITION with the review skill's lenses + the destination check, so this is NOT an "add a set lens" rewrite — it is naming the three lenses explicitly.
>
> MAKE THE MINIMAL CHANGE: add the words "graph coherence / gaps / overlap / goal-composition" to the existing set-level framing in `buildSliceReviewPrompt` (and, if in scope, the `review` skill's set-of-slices section — else flag it), with a prompt-CONTENT assertion. Do NOT rewrite the working prompt; do NOT close the slice as a no-op (the maintainer chose to name them).
>
> "Done" = the prompt explicitly names the whole-set lenses, a content assertion covers it, the `review` skill edit is done-or-flagged, and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
